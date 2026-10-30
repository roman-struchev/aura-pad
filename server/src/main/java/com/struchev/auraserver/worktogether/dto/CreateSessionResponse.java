package com.struchev.auraserver.worktogether.dto;

import java.time.Instant;

/** specification.md §3.1 */
public record CreateSessionResponse(String sessionId, String hostToken, Instant expiresAt) {
}
