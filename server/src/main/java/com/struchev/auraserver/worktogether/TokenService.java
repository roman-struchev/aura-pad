package com.struchev.auraserver.worktogether;

import tools.jackson.databind.ObjectMapper;
import com.struchev.auraserver.worktogether.exception.InvalidTokenException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;

/**
 * Mints and verifies opaque, HMAC-signed tokens carrying {sessionId, role, linkId, exp}.
 * A token's signature and {@code exp} claim are the sole trust anchor per
 * specification.md §7 — the backend never trusts a role/sessionId a client merely
 * asserts without a valid signature over it.
 */
@Service
public class TokenService {

    private static final Logger log = LoggerFactory.getLogger(TokenService.class);
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();
    private static final String ALGORITHM = "HmacSHA256";

    private final ObjectMapper objectMapper;
    private final SecretKeySpec key;

    public TokenService(ObjectMapper objectMapper,
                         @Value("${worktogether.token-secret:}") String configuredSecret) {
        this.objectMapper = objectMapper;
        this.key = new SecretKeySpec(resolveSecret(configuredSecret), ALGORITHM);
    }

    private static byte[] resolveSecret(String configuredSecret) {
        if (configuredSecret != null && !configuredSecret.isBlank()) {
            return configuredSecret.getBytes(StandardCharsets.UTF_8);
        }
        log.warn("worktogether.token-secret is not set — generating a random secret for this process. "
                + "All Work Together tokens/links will become invalid on restart. "
                + "Set the WORKTOGETHER_TOKEN_SECRET env var for a stable secret.");
        byte[] secret = new byte[32];
        new SecureRandom().nextBytes(secret);
        return secret;
    }

    public String mint(String sessionId, Role role, String linkId, Instant expiresAt) {
        Payload payload = new Payload(sessionId, role, linkId, expiresAt.getEpochSecond());
        byte[] payloadBytes = writeBytes(payload);
        String payloadPart = ENCODER.encodeToString(payloadBytes);
        String signaturePart = ENCODER.encodeToString(sign(payloadBytes));
        return payloadPart + "." + signaturePart;
    }

    /** Verifies signature + expiry only; use when the caller doesn't yet know which session a token belongs to. */
    public TokenClaims verify(String token) {
        return verify(token, null);
    }

    /** Verifies signature + expiry, and (if given) that the token was minted for {@code expectedSessionId}. */
    public TokenClaims verify(String token, String expectedSessionId) {
        if (token == null || token.isBlank()) {
            throw new InvalidTokenException("Missing token");
        }
        int dot = token.indexOf('.');
        if (dot < 0 || token.indexOf('.', dot + 1) >= 0) {
            throw new InvalidTokenException("Malformed token");
        }
        byte[] payloadBytes;
        byte[] signature;
        try {
            payloadBytes = DECODER.decode(token.substring(0, dot));
            signature = DECODER.decode(token.substring(dot + 1));
        } catch (IllegalArgumentException e) {
            throw new InvalidTokenException("Malformed token");
        }
        if (!MessageDigest.isEqual(signature, sign(payloadBytes))) {
            throw new InvalidTokenException("Invalid token signature");
        }
        Payload payload = readPayload(payloadBytes);
        if (expectedSessionId != null && !payload.sessionId.equals(expectedSessionId)) {
            throw new InvalidTokenException("Token does not match session");
        }
        Instant expiresAt = Instant.ofEpochSecond(payload.exp);
        if (Instant.now().isAfter(expiresAt)) {
            throw new InvalidTokenException("Token expired");
        }
        return new TokenClaims(payload.sessionId, payload.role, payload.linkId, expiresAt);
    }

    private byte[] sign(byte[] payloadBytes) {
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(key);
            return mac.doFinal(payloadBytes);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to sign token", e);
        }
    }

    private byte[] writeBytes(Payload payload) {
        try {
            return objectMapper.writeValueAsBytes(payload);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to encode token payload", e);
        }
    }

    private Payload readPayload(byte[] payloadBytes) {
        try {
            return objectMapper.readValue(payloadBytes, Payload.class);
        } catch (Exception e) {
            throw new InvalidTokenException("Malformed token payload");
        }
    }

    /** Wire shape of the signed payload. Field names are deliberately short; the token is opaque to clients anyway. */
    private record Payload(String sessionId, Role role, String linkId, long exp) {
    }
}
