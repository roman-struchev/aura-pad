package com.struchev.auraserver.worktogether;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.server.ServerHttpRequest;

/** Best-effort client IP extraction for rate-limiting keys, trusting X-Forwarded-For (set by the reverse proxy). */
public final class ClientIp {

    private ClientIp() {
    }

    public static String of(HttpServletRequest request) {
        String forwardedFor = request.getHeader("X-Forwarded-For");
        if (forwardedFor != null && !forwardedFor.isBlank()) {
            return firstHop(forwardedFor);
        }
        return request.getRemoteAddr();
    }

    public static String of(ServerHttpRequest request) {
        String forwardedFor = request.getHeaders().getFirst("X-Forwarded-For");
        if (forwardedFor != null && !forwardedFor.isBlank()) {
            return firstHop(forwardedFor);
        }
        return request.getRemoteAddress() != null
                ? request.getRemoteAddress().getAddress().getHostAddress()
                : "unknown";
    }

    private static String firstHop(String forwardedFor) {
        return forwardedFor.split(",")[0].trim();
    }
}
