package com.struchev.auraserver.worktogether.exception;

/** Maps to HTTP 401 — bad signature, wrong sessionId, expired, or revoked (specification.md §7). */
public class InvalidTokenException extends RuntimeException {
    public InvalidTokenException(String message) {
        super(message);
    }
}
