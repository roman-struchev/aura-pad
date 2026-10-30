package com.struchev.auraserver.worktogether.ws;

import com.struchev.auraserver.worktogether.ClientIp;
import com.struchev.auraserver.worktogether.ConnectAuth;
import com.struchev.auraserver.worktogether.RateLimiter;
import com.struchev.auraserver.worktogether.SessionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Validates the {@code token} query param before the WebSocket upgrade completes,
 * rejecting with 401 rather than accept-then-close (specification.md §4, step 1).
 * On success, stashes the resolved role/linkId/displayName/connectionId as session
 * attributes for {@link WorkTogetherWebSocketHandler} to pick up.
 */
@Component
public class WorkTogetherHandshakeInterceptor implements HandshakeInterceptor {

    public static final String ATTR_SESSION_ID = "wtSessionId";
    public static final String ATTR_CONNECT_AUTH = "wtConnectAuth";

    private static final Logger log = LoggerFactory.getLogger(WorkTogetherHandshakeInterceptor.class);
    private static final Pattern SESSION_PATH = Pattern.compile("/v1/sessions/([^/]+)/connect$");

    private final SessionService sessionService;
    private final RateLimiter rateLimiter;

    public WorkTogetherHandshakeInterceptor(SessionService sessionService, RateLimiter rateLimiter) {
        this.sessionService = sessionService;
        this.rateLimiter = rateLimiter;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                    WebSocketHandler wsHandler, Map<String, Object> attributes) {
        if (!rateLimiter.tryAcquire("connect:" + ClientIp.of(request))) {
            response.setStatusCode(HttpStatus.TOO_MANY_REQUESTS);
            return false;
        }
        Matcher matcher = SESSION_PATH.matcher(request.getURI().getPath());
        if (!matcher.find()) {
            response.setStatusCode(HttpStatus.NOT_FOUND);
            return false;
        }
        String sessionId = matcher.group(1);
        String token = UriComponentsBuilder.fromUri(request.getURI()).build().getQueryParams().getFirst("token");
        try {
            ConnectAuth auth = sessionService.resolveConnectAuth(sessionId, token);
            attributes.put(ATTR_SESSION_ID, sessionId);
            attributes.put(ATTR_CONNECT_AUTH, auth);
            return true;
        } catch (Exception e) {
            log.debug("Rejecting WebSocket upgrade for session {}: {}", sessionId, e.getMessage());
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                WebSocketHandler wsHandler, Exception exception) {
        // no-op
    }
}
