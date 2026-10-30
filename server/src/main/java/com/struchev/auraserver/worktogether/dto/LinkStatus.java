package com.struchev.auraserver.worktogether.dto;

import com.struchev.auraserver.worktogether.Role;

import java.time.Instant;

/** specification.md §3.5 */
public record LinkStatus(String linkId, Role role, Instant expiresAt, boolean revoked) {
}
