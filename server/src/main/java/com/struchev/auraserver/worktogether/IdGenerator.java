package com.struchev.auraserver.worktogether;

import java.security.SecureRandom;
import java.util.Base64;

/**
 * Generates opaque, URL-safe ids for sessions/links/connections, e.g. {@code sess_9fK3Q...}.
 */
public final class IdGenerator {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final char[] ALPHANUMERIC =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".toCharArray();

    private IdGenerator() {
    }

    public static String next(String prefix) {
        return next(prefix, 15);
    }

    /**
     * @param randomBytes how much entropy to spend - 15 bytes (120 bits) for ids that
     *                    are never brute-forceable over the network (session/connection
     *                    ids); shorter is reasonable for ids meant to be short, human
     *                    shareable links, as long as the endpoint that accepts them is
     *                    rate-limited (see linkId in SessionService#mintLink).
     */
    public static String next(String prefix, int randomBytes) {
        byte[] bytes = new byte[randomBytes];
        RANDOM.nextBytes(bytes);
        return prefix + ENCODER.encodeToString(bytes);
    }

    /**
     * Like {@link #next(String, int)}, but drawn from a plain [A-Za-z0-9] alphabet
     * instead of base64url - no {@code -}/{@code _} to complicate reading a link out
     * loud or double-clicking to select it. {@code length} characters from a
     * 62-symbol alphabet carry {@code length * log2(62) ≈ length * 5.95} bits of
     * entropy, comparable to base64url of the same length.
     */
    public static String nextAlphanumeric(String prefix, int length) {
        StringBuilder sb = new StringBuilder(prefix.length() + length);
        sb.append(prefix);
        for (int i = 0; i < length; i++) {
            sb.append(ALPHANUMERIC[RANDOM.nextInt(ALPHANUMERIC.length)]);
        }
        return sb.toString();
    }
}
