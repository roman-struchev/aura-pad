package com.struchev.auraserver.worktogether.exception;

/** Maps to HTTP 404 — unknown sessionId/linkId. */
public class NotFoundException extends RuntimeException {
    public NotFoundException(String message) {
        super(message);
    }
}
