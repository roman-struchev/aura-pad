package com.struchev.auraserver.worktogether.exception;

/** Maps to HTTP 503 - the server's memory budget for live sessions is used up. */
public class CapacityExceededException extends RuntimeException {
    public CapacityExceededException(String message) {
        super(message);
    }
}
