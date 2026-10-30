package com.struchev.auraserver.worktogether.dto;

import com.struchev.auraserver.worktogether.Role;

import java.time.Instant;

/** specification.md §3.2 */
public record MintLinkResponse(String linkId, String token, String url, Role role, Instant expiresAt) {
}
