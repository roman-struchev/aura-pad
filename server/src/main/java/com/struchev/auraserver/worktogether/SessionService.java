package com.struchev.auraserver.worktogether;

import tools.jackson.databind.ObjectMapper;
import com.struchev.auraserver.worktogether.dto.CreateSessionRequest;
import com.struchev.auraserver.worktogether.dto.CreateSessionResponse;
import com.struchev.auraserver.worktogether.dto.LinkStatus;
import com.struchev.auraserver.worktogether.dto.MintLinkRequest;
import com.struchev.auraserver.worktogether.dto.MintLinkResponse;
import com.struchev.auraserver.worktogether.dto.ParticipantStatus;
import com.struchev.auraserver.worktogether.dto.SessionStatusResponse;
import com.struchev.auraserver.worktogether.exception.BadRequestException;
import com.struchev.auraserver.worktogether.exception.InvalidTokenException;
import com.struchev.auraserver.worktogether.exception.NotFoundException;
import com.struchev.auraserver.worktogether.exception.ValidationException;
import com.struchev.auraserver.worktogether.model.WtConnection;
import com.struchev.auraserver.worktogether.model.WtLink;
import com.struchev.auraserver.worktogether.model.WtSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Core business logic for the Work Together backend: session/link lifecycle,
 * connection bookkeeping, and the periodic sweep that enforces TTLs
 * (specification.md §3, §5, §7).
 */
@Service
public class SessionService {

    private static final Logger log = LoggerFactory.getLogger(SessionService.class);

    private final TokenService tokenService;
    private final ObjectMapper objectMapper;
    private final long maxSessionTtlCeilingSeconds;

    private final ConcurrentHashMap<String, WtSession> sessions = new ConcurrentHashMap<>();
    // Reverse index so the short guest URL (/j/{linkId}) can be resolved
    // without needing the full signed token round-tripped through it. Kept
    // in sync with `sessions`: entries are removed when the owning session
    // is torn down (see the private endSession(WtSession) overload).
    private final ConcurrentHashMap<String, String> linkIdToSessionId = new ConcurrentHashMap<>();

    public SessionService(TokenService tokenService, ObjectMapper objectMapper,
                           @Value("${worktogether.max-session-ttl-seconds:604800}") long maxSessionTtlCeilingSeconds) {
        this.tokenService = tokenService;
        this.objectMapper = objectMapper;
        this.maxSessionTtlCeilingSeconds = maxSessionTtlCeilingSeconds;
    }

    // ---- §3.1 create session ----

    public CreateSessionResponse createSession(CreateSessionRequest request) {
        if (isBlank(request.filePath()) || isBlank(request.language()) || request.content() == null) {
            throw new BadRequestException("filePath, language and content are required");
        }
        long maxTtlSeconds = request.maxTtlSeconds() != null ? request.maxTtlSeconds() : maxSessionTtlCeilingSeconds;
        if (maxTtlSeconds <= 0) {
            throw new BadRequestException("maxTtlSeconds must be positive");
        }
        if (maxTtlSeconds > maxSessionTtlCeilingSeconds) {
            throw new ValidationException("maxTtlSeconds exceeds the server's ceiling of "
                    + maxSessionTtlCeilingSeconds + " seconds");
        }

        Instant now = Instant.now();
        Instant expiresAt = now.plusSeconds(maxTtlSeconds);
        String sessionId = IdGenerator.next("sess_");
        WtSession session = new WtSession(sessionId, request.filePath(), request.language(),
                request.content(), now, maxTtlSeconds, expiresAt);
        sessions.put(sessionId, session);

        String hostToken = tokenService.mint(sessionId, Role.HOST, null, expiresAt);
        log.info("Created session {} for {} (expires {})", sessionId, request.filePath(), expiresAt);
        return new CreateSessionResponse(sessionId, hostToken, expiresAt);
    }

    // ---- §3.2 mint link ----

    public MintLinkResponse mintLink(String sessionId, MintLinkRequest request, String publicBaseUrl) {
        WtSession session = requireLiveSession(sessionId);
        if (request.role() == null || request.role() == Role.HOST) {
            throw new BadRequestException("role must be 'write' or 'read'");
        }
        if (request.ttlSeconds() == null || request.ttlSeconds() <= 0) {
            throw new BadRequestException("ttlSeconds must be positive");
        }
        if (request.ttlSeconds() > session.maxTtlSeconds()) {
            throw new ValidationException("ttlSeconds exceeds this session's maxTtlSeconds ("
                    + session.maxTtlSeconds() + ")");
        }

        Instant now = Instant.now();
        Instant expiresAt = now.plusSeconds(request.ttlSeconds());
        if (expiresAt.isAfter(session.expiresAt())) {
            expiresAt = session.expiresAt();
        }
        // Short and plain [A-Za-z0-9] on purpose - this is what ends up in the
        // human-shareable URL, so no "lnk_" prefix (the JSON key already says
        // what it is) and no base64 "-"/"_" to complicate reading it out loud.
        // 11 alphanumeric characters (~65 bits of entropy) is still infeasible
        // to brute-force, especially combined with the per-IP rate limit on
        // GET /j/{linkId} and the WS connect endpoint (see GuestPageController,
        // WorkTogetherHandshakeInterceptor).
        String linkId = IdGenerator.nextAlphanumeric("", 11);
        WtLink link = new WtLink(linkId, sessionId, request.role(), now, expiresAt);
        session.addLink(link);
        linkIdToSessionId.put(linkId, sessionId);

        String token = tokenService.mint(sessionId, request.role(), linkId, expiresAt);
        // The link itself (not the raw signed token) is what's embedded in the
        // shareable URL - much shorter, and just as unguessable (same amount
        // of random entropy). GuestPageController resolves it back to a
        // session/link and mints an equivalent WS token on the fly.
        String url = publicBaseUrl + "/j/" + linkId;
        return new MintLinkResponse(linkId, token, url, request.role(), expiresAt);
    }

    // ---- §3.3 revoke link ----

    public void revokeLink(String sessionId, String linkId) {
        WtSession session = requireSession(sessionId);
        WtLink link = session.link(linkId);
        if (link == null) {
            throw new NotFoundException("Unknown link: " + linkId);
        }
        if (link.revoke()) {
            closeConnections(session, c -> linkId.equals(c.linkId()), WorkTogetherCloseCodes.LINK_REVOKED);
            notifyHosts(session, Map.of("type", "link-revoked", "linkId", linkId));
        }
    }

    // ---- §3.4 end session ----

    public void endSession(String sessionId) {
        WtSession session = requireSession(sessionId);
        endSession(session);
    }

    private void endSession(WtSession session) {
        if (session.end()) {
            closeConnections(session, c -> true, WorkTogetherCloseCodes.SESSION_ENDED);
            sessions.remove(session.sessionId());
            for (WtLink link : session.links()) {
                linkIdToSessionId.remove(link.linkId());
            }
            log.info("Ended session {}", session.sessionId());
        }
    }

    // ---- §3.5 status ----

    public SessionStatusResponse getStatus(String sessionId) {
        WtSession session = requireSession(sessionId);
        List<LinkStatus> links = session.links().stream()
                .map(l -> new LinkStatus(l.linkId(), l.role(), l.expiresAt(), l.revoked()))
                .toList();
        List<ParticipantStatus> participants = session.connections().stream()
                .map(c -> new ParticipantStatus(c.connectionId(), c.role(), c.displayName(), c.joinedAt()))
                .toList();
        return new SessionStatusResponse(session.sessionId(), session.filePath(), session.createdAt(),
                links, participants);
    }

    /**
     * Resolves the short {@code linkId} from a guest join URL back to its session/link
     * (specification.md §6) - or {@code null} if it never existed or its session is gone.
     * Doesn't check expiry/revocation itself; callers render the appropriate error page
     * based on {@link WtLink#revoked()}/{@link WtLink#expiresAt()} and {@link WtSession#ended()}.
     */
    public GuestLinkContext resolveGuestLink(String linkId) {
        String sessionId = linkIdToSessionId.get(linkId);
        if (sessionId == null) {
            return null;
        }
        WtSession session = sessions.get(sessionId);
        if (session == null) {
            return null;
        }
        WtLink link = session.link(linkId);
        if (link == null) {
            return null;
        }
        return new GuestLinkContext(session, link);
    }

    // ---- §4 WebSocket connect ----

    public ConnectAuth resolveConnectAuth(String sessionId, String token) {
        WtSession session = sessions.get(sessionId);
        if (session == null || session.ended()) {
            throw new InvalidTokenException("Unknown session");
        }
        TokenClaims claims = tokenService.verify(token, sessionId);
        String displayName;
        if (claims.role() == Role.HOST) {
            displayName = "Host";
        } else {
            WtLink link = session.link(claims.linkId());
            if (link == null || !link.isLive(Instant.now())) {
                throw new InvalidTokenException("Link is no longer valid");
            }
            displayName = "Guest " + session.nextGuestNumber();
        }
        return new ConnectAuth(claims.role(), claims.linkId(), displayName);
    }

    public void registerConnection(WtConnection connection) {
        WtSession session = sessions.get(connection.sessionId());
        if (session == null) {
            return;
        }
        session.addConnection(connection);
        notifyHosts(session, connection, Map.of(
                "type", "join",
                "connectionId", connection.connectionId(),
                "role", connection.role(),
                "displayName", connection.displayName()));
    }

    public void unregisterConnection(String sessionId, String connectionId) {
        WtSession session = sessions.get(sessionId);
        if (session == null) {
            return;
        }
        session.removeConnection(connectionId);
        notifyHosts(session, Map.of("type", "leave", "connectionId", connectionId));
    }

    public WtSession findLiveSession(String sessionId) {
        WtSession session = sessions.get(sessionId);
        return (session != null && !session.ended()) ? session : null;
    }

    // ---- lifecycle sweep ----

    @Scheduled(fixedRateString = "#{${worktogether.cleanup-interval-seconds:15} * 1000}")
    void sweep() {
        Instant now = Instant.now();
        for (WtSession session : sessions.values()) {
            if (!session.isLive(now)) {
                endSession(session);
                continue;
            }
            for (WtLink link : session.links()) {
                if (!link.revoked() && now.isAfter(link.expiresAt())) {
                    closeConnections(session, c -> link.linkId().equals(c.linkId()), WorkTogetherCloseCodes.LINK_EXPIRED);
                }
            }
        }
    }

    // ---- helpers ----

    private WtSession requireSession(String sessionId) {
        WtSession session = sessions.get(sessionId);
        if (session == null) {
            throw new NotFoundException("Unknown session: " + sessionId);
        }
        return session;
    }

    private WtSession requireLiveSession(String sessionId) {
        WtSession session = requireSession(sessionId);
        if (session.ended()) {
            throw new NotFoundException("Session has ended: " + sessionId);
        }
        return session;
    }

    private void closeConnections(WtSession session, java.util.function.Predicate<WtConnection> filter, CloseStatus status) {
        for (WtConnection connection : session.connections()) {
            if (filter.test(connection)) {
                closeQuietly(connection.webSocketSession(), status);
            }
        }
    }

    private void closeQuietly(WebSocketSession webSocketSession, CloseStatus status) {
        try {
            if (webSocketSession.isOpen()) {
                webSocketSession.close(status);
            }
        } catch (Exception e) {
            log.debug("Failed to close WebSocket session {}: {}", webSocketSession.getId(), e.getMessage());
        }
    }

    private void notifyHosts(WtSession session, Map<String, Object> payload) {
        notifyHosts(session, null, payload);
    }

    private void notifyHosts(WtSession session, WtConnection exclude, Map<String, Object> payload) {
        for (WtConnection connection : session.connections()) {
            if (connection.role() != Role.HOST || connection.equals(exclude)) {
                continue;
            }
            sendControl(connection.webSocketSession(), payload);
        }
    }

    private void sendControl(WebSocketSession webSocketSession, Map<String, Object> payload) {
        try {
            byte[] json = objectMapper.writeValueAsBytes(payload);
            byte[] frame = new byte[json.length + 1];
            frame[0] = 2; // control tag, specification.md §5
            System.arraycopy(json, 0, frame, 1, json.length);
            if (webSocketSession.isOpen()) {
                webSocketSession.sendMessage(new org.springframework.web.socket.BinaryMessage(frame));
            }
        } catch (Exception e) {
            log.debug("Failed to send control message: {}", e.getMessage());
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
