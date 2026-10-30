package com.struchev.auraserver.worktogether;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Simple fixed-window per-key rate limiter (specification.md §7: "Rate-limit
 * session creation and connection attempts per Host/IP to prevent abuse of a
 * shared/multi-tenant backend deployment").
 */
@Component
public class RateLimiter {

    private record Window(long minute, AtomicInteger count) {
    }

    private final int maxRequestsPerMinute;
    private final Map<String, Window> windows = new ConcurrentHashMap<>();

    public RateLimiter(@Value("${worktogether.rate-limit.max-per-minute:30}") int maxRequestsPerMinute) {
        this.maxRequestsPerMinute = maxRequestsPerMinute;
    }

    /** @return true if the request is allowed, false if {@code key} is over the limit for the current minute. */
    public boolean tryAcquire(String key) {
        long currentMinute = Instant.now().getEpochSecond() / 60;
        Window window = windows.compute(key, (k, existing) ->
                (existing == null || existing.minute() != currentMinute)
                        ? new Window(currentMinute, new AtomicInteger(0))
                        : existing);
        return window.count().incrementAndGet() <= maxRequestsPerMinute;
    }

    @Scheduled(fixedRate = 300_000)
    void evictStaleWindows() {
        long currentMinute = Instant.now().getEpochSecond() / 60;
        windows.entrySet().removeIf(e -> e.getValue().minute() != currentMinute);
    }
}
