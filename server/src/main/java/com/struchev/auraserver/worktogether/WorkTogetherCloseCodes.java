package com.struchev.auraserver.worktogether;

import org.springframework.web.socket.CloseStatus;

/** WebSocket close codes, specification.md §5.1. */
public final class WorkTogetherCloseCodes {

    public static final CloseStatus LINK_EXPIRED = new CloseStatus(4001, "link expired");
    public static final CloseStatus LINK_REVOKED = new CloseStatus(4002, "link revoked");
    public static final CloseStatus SESSION_ENDED = new CloseStatus(4003, "session ended");
    public static final CloseStatus INVALID_TOKEN = new CloseStatus(4004, "invalid or unknown token");

    private WorkTogetherCloseCodes() {
    }
}
