package com.struchev.auraserver.worktogether;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Size caps that keep the in-memory store bounded (see application.properties).
 *
 * @param maxContentBytes   largest file a session may be created with
 * @param maxMessageBytes   largest WebSocket frame (a snapshot is the whole document)
 * @param memoryBudgetBytes total content + snapshot bytes across all live sessions
 * @param maxSessionsPerIp  live sessions one client address may hold at once
 */
@ConfigurationProperties("worktogether.limits")
public record SessionLimits(long maxContentBytes, int maxMessageBytes, long memoryBudgetBytes,
                            int maxSessionsPerIp) {
}
