package com.struchev.auraserver.worktogether;

import java.time.Instant;

/**
 * Decoded, verified contents of a session/link token (specification.md §7:
 * "opaque to the client and must be verified server-side (signature + exp)").
 */
public record TokenClaims(String sessionId, Role role, String linkId, Instant expiresAt) {
}
