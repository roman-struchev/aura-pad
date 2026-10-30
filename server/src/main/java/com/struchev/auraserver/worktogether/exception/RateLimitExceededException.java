package com.struchev.auraserver.worktogether.exception;

/** Maps to HTTP 429 — per-IP rate limit exceeded (specification.md §7). */
public class RateLimitExceededException extends RuntimeException {
    public RateLimitExceededException(String message) {
        super(message);
    }
}
