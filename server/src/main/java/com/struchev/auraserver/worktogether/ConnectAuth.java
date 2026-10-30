package com.struchev.auraserver.worktogether;

/** Result of validating a WebSocket connect attempt (specification.md §4, step 1). */
public record ConnectAuth(Role role, String linkId, String displayName) {
}
