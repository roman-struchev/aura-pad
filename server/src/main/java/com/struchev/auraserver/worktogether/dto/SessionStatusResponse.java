package com.struchev.auraserver.worktogether.dto;

import java.time.Instant;
import java.util.List;

/** specification.md §3.5 */
public record SessionStatusResponse(String sessionId, String filePath, Instant createdAt,
                                     List<LinkStatus> links, List<ParticipantStatus> participants) {
}
