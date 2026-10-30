package com.struchev.auraserver.worktogether.model;

import com.struchev.auraserver.worktogether.Role;
import org.springframework.web.socket.WebSocketSession;

import java.time.Instant;

/**
 * A live WebSocket participant on a {@link WtSession} (specification.md §4/§5).
 */
public class WtConnection {

    private final String connectionId;
    private final String sessionId;
    private final Role role;
    private final String linkId;
    private final Instant joinedAt;
    private final String displayName;
    private final WebSocketSession webSocketSession;

    public WtConnection(String connectionId, String sessionId, Role role, String linkId,
                         Instant joinedAt, String displayName, WebSocketSession webSocketSession) {
        this.connectionId = connectionId;
        this.sessionId = sessionId;
        this.role = role;
        this.linkId = linkId;
        this.joinedAt = joinedAt;
        this.displayName = displayName;
        this.webSocketSession = webSocketSession;
    }

    public String connectionId() {
        return connectionId;
    }

    public String sessionId() {
        return sessionId;
    }

    public Role role() {
        return role;
    }

    /** Link id this connection authenticated with, or {@code null} for the host. */
    public String linkId() {
        return linkId;
    }

    public Instant joinedAt() {
        return joinedAt;
    }

    public String displayName() {
        return displayName;
    }

    public WebSocketSession webSocketSession() {
        return webSocketSession;
    }
}
