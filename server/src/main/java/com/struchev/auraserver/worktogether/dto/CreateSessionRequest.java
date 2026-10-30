package com.struchev.auraserver.worktogether.dto;

/** specification.md §3.1 */
public record CreateSessionRequest(String filePath, String language, String content, Long maxTtlSeconds) {
}
