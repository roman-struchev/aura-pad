package com.struchev.auraserver.worktogether.exception;

/** Maps to HTTP 400 — malformed/missing request fields. */
public class BadRequestException extends RuntimeException {
    public BadRequestException(String message) {
        super(message);
    }
}
