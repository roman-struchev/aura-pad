package com.struchev.auraserver.worktogether;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServletServerHttpRequest;

/**
 * Client address for rate-limiting keys. Tomcat's RemoteIpValve
 * ({@code server.forward-headers-strategy=native}) has already resolved it:
 * X-Forwarded-For is honoured only when the request came from a local proxy
 * (cloudflared), and then only the hop that proxy added - so a client can't
 * pick its own address by sending the header itself.
 */
public final class ClientIp {

    private ClientIp() {
    }

    public static String of(HttpServletRequest request) {
        return request.getRemoteAddr();
    }

    public static String of(ServerHttpRequest request) {
        if (request instanceof ServletServerHttpRequest servletRequest) {
            return of(servletRequest.getServletRequest());
        }
        return request.getRemoteAddress() != null
                ? request.getRemoteAddress().getAddress().getHostAddress()
                : "unknown";
    }
}
