package com.struchev.auraserver.worktogether.web;

import com.struchev.auraserver.worktogether.ClientIp;
import com.struchev.auraserver.worktogether.RateLimiter;
import com.struchev.auraserver.worktogether.Role;
import com.struchev.auraserver.worktogether.SessionService;
import com.struchev.auraserver.worktogether.TokenClaims;
import com.struchev.auraserver.worktogether.TokenService;
import com.struchev.auraserver.worktogether.dto.CreateSessionRequest;
import com.struchev.auraserver.worktogether.dto.CreateSessionResponse;
import com.struchev.auraserver.worktogether.dto.MintLinkRequest;
import com.struchev.auraserver.worktogether.dto.MintLinkResponse;
import com.struchev.auraserver.worktogether.dto.SessionStatusResponse;
import com.struchev.auraserver.worktogether.exception.InvalidTokenException;
import com.struchev.auraserver.worktogether.exception.RateLimitExceededException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

/**
 * Host-facing REST API, specification.md §3. Guests never call this — they
 * only ever use the link URL and the WebSocket (see {@code GuestPageController}
 * and the {@code ws} package).
 */
@RestController
@RequestMapping("/v1/sessions")
public class SessionController {

    private final SessionService sessionService;
    private final TokenService tokenService;
    private final RateLimiter rateLimiter;
    /** Null when unset — see {@link #resolvePublicBaseUrl}. */
    private final String configuredPublicBaseUrl;

    public SessionController(SessionService sessionService, TokenService tokenService, RateLimiter rateLimiter,
                              @Value("${worktogether.public-base-url:}") String configuredPublicBaseUrl) {
        this.sessionService = sessionService;
        this.tokenService = tokenService;
        this.rateLimiter = rateLimiter;
        String trimmed = configuredPublicBaseUrl == null ? "" : configuredPublicBaseUrl.strip();
        this.configuredPublicBaseUrl = trimmed.isEmpty() ? null : stripTrailingSlash(trimmed);
    }

    @PostMapping
    public ResponseEntity<CreateSessionResponse> createSession(@RequestBody CreateSessionRequest request,
                                                                 HttpServletRequest servletRequest) {
        if (!rateLimiter.tryAcquire("create:" + ClientIp.of(servletRequest))) {
            throw new RateLimitExceededException("Rate limit exceeded, try again shortly");
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(sessionService.createSession(request));
    }

    @PostMapping("/{sessionId}/links")
    public ResponseEntity<MintLinkResponse> mintLink(@PathVariable String sessionId,
                                                       @RequestBody MintLinkRequest request,
                                                       HttpServletRequest servletRequest) {
        requireHostToken(servletRequest, sessionId);
        String publicBaseUrl = resolvePublicBaseUrl(servletRequest);
        return ResponseEntity.status(HttpStatus.CREATED).body(sessionService.mintLink(sessionId, request, publicBaseUrl));
    }

    /**
     * Every endpoint below acts on an existing session, so (per aura-pad's spec) the Host
     * must present its {@code hostToken} as {@code Authorization: Bearer <hostToken>} -
     * knowing a sessionId alone (not a secret; it can end up in logs) must not be enough
     * to revoke links, end a session, or read its participant list.
     */
    private void requireHostToken(HttpServletRequest servletRequest, String sessionId) {
        String header = servletRequest.getHeader("Authorization");
        if (header == null || !header.regionMatches(true, 0, "Bearer ", 0, 7)) {
            throw new InvalidTokenException("Missing Authorization: Bearer <hostToken> header");
        }
        TokenClaims claims = tokenService.verify(header.substring(7).strip(), sessionId);
        if (claims.role() != Role.HOST) {
            throw new InvalidTokenException("Token is not a host token for this session");
        }
    }

    /**
     * {@link #configuredPublicBaseUrl} if the operator pinned one; otherwise derived from
     * this request's Host/X-Forwarded-* headers (trusted because of
     * {@code server.forward-headers-strategy=framework} — see application.properties).
     * The reverse proxy in front of this server must actually set those headers to the
     * public-facing host/scheme for this fallback to produce a guest-reachable URL.
     */
    private String resolvePublicBaseUrl(HttpServletRequest servletRequest) {
        if (configuredPublicBaseUrl != null) {
            return configuredPublicBaseUrl;
        }
        return stripTrailingSlash(ServletUriComponentsBuilder.fromContextPath(servletRequest).build().toUriString());
    }

    private static String stripTrailingSlash(String url) {
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    @DeleteMapping("/{sessionId}/links/{linkId}")
    public ResponseEntity<Void> revokeLink(@PathVariable String sessionId, @PathVariable String linkId,
                                            HttpServletRequest servletRequest) {
        requireHostToken(servletRequest, sessionId);
        sessionService.revokeLink(sessionId, linkId);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{sessionId}")
    public ResponseEntity<Void> endSession(@PathVariable String sessionId, HttpServletRequest servletRequest) {
        requireHostToken(servletRequest, sessionId);
        sessionService.endSession(sessionId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{sessionId}")
    public ResponseEntity<SessionStatusResponse> getStatus(@PathVariable String sessionId,
                                                            HttpServletRequest servletRequest) {
        requireHostToken(servletRequest, sessionId);
        return ResponseEntity.ok(sessionService.getStatus(sessionId));
    }

}
