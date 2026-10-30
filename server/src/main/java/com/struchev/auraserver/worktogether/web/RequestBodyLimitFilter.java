package com.struchev.auraserver.worktogether.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Caps the request body of the REST API, so a huge upload is refused before it
 * is parsed into memory. A declared Content-Length over the cap gets 413 up
 * front; a body without one (chunked) is cut off once it passes the cap, which
 * fails the JSON parse with 400.
 */
@Component
public class RequestBodyLimitFilter extends OncePerRequestFilter {

    private final long maxBodyBytes;

    // A plain property rather than SessionLimits, so MVC test slices (which pick
    // up filters but not configuration properties) still build this.
    public RequestBodyLimitFilter(@Value("${worktogether.limits.max-content-bytes}") long maxContentBytes) {
        // The file content travels JSON-escaped, which can grow it; leave room for that.
        this.maxBodyBytes = maxContentBytes * 2 + 64 * 1024;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/v1/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (request.getContentLengthLong() > maxBodyBytes) {
            response.sendError(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
            return;
        }
        chain.doFilter(new LimitedRequest(request, maxBodyBytes), response);
    }

    private static final class LimitedRequest extends HttpServletRequestWrapper {
        private final long limit;

        LimitedRequest(HttpServletRequest request, long limit) {
            super(request);
            this.limit = limit;
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            ServletInputStream in = super.getInputStream();
            return new ServletInputStream() {
                private long read;

                @Override
                public int read() throws IOException {
                    int b = in.read();
                    if (b >= 0) count(1);
                    return b;
                }

                @Override
                public int read(byte[] buf, int off, int len) throws IOException {
                    int n = in.read(buf, off, len);
                    if (n > 0) count(n);
                    return n;
                }

                private void count(int n) throws IOException {
                    read += n;
                    if (read > limit) {
                        throw new IOException("Request body exceeds " + limit + " bytes");
                    }
                }

                @Override
                public boolean isFinished() {
                    return in.isFinished();
                }

                @Override
                public boolean isReady() {
                    return in.isReady();
                }

                @Override
                public void setReadListener(ReadListener listener) {
                    in.setReadListener(listener);
                }
            };
        }
    }
}
