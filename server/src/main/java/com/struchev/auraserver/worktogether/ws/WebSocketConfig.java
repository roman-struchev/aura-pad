package com.struchev.auraserver.worktogether.ws;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers the raw (non-SockJS/STOMP) WebSocket endpoint from specification.md §4:
 * {@code GET /v1/sessions/{sessionId}/connect?token=...}. Auth is via the signed
 * token, not cookies/origin, so any origin may connect — see
 * {@link WorkTogetherHandshakeInterceptor}.
 */
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final WorkTogetherWebSocketHandler handler;
    private final WorkTogetherHandshakeInterceptor interceptor;

    public WebSocketConfig(WorkTogetherWebSocketHandler handler, WorkTogetherHandshakeInterceptor interceptor) {
        this.handler = handler;
        this.interceptor = interceptor;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/v1/sessions/*/connect")
                .addInterceptors(interceptor)
                .setAllowedOriginPatterns("*");
    }
}
