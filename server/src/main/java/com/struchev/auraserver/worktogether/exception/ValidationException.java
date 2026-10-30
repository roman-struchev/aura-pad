package com.struchev.auraserver.worktogether.exception;

/** Maps to HTTP 422 — e.g. a link's requested ttlSeconds exceeds the session's maxTtlSeconds (specification.md §3.2). */
public class ValidationException extends RuntimeException {
    public ValidationException(String message) {
        super(message);
    }
}
