package com.struchev.auraserver.worktogether.dto;

import com.struchev.auraserver.worktogether.Role;

/** specification.md §3.2 — {@code role} must be {@code write} or {@code read}, never {@code host}. */
public record MintLinkRequest(Role role, Long ttlSeconds) {
}
