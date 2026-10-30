package com.struchev.auraserver.worktogether;

import tools.jackson.databind.ObjectMapper;
import com.struchev.auraserver.worktogether.exception.InvalidTokenException;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TokenServiceTest {

    private final TokenService tokenService = new TokenService(new ObjectMapper(), "test-secret");

    @Test
    void mintsAndVerifiesRoundTrip() {
        Instant exp = Instant.now().plusSeconds(60);
        String token = tokenService.mint("sess_1", Role.WRITE, "lnk_1", exp);

        TokenClaims claims = tokenService.verify(token, "sess_1");

        assertThat(claims.sessionId()).isEqualTo("sess_1");
        assertThat(claims.role()).isEqualTo(Role.WRITE);
        assertThat(claims.linkId()).isEqualTo("lnk_1");
    }

    @Test
    void rejectsTamperedPayload() {
        String token = tokenService.mint("sess_1", Role.HOST, null, Instant.now().plusSeconds(60));
        String[] parts = token.split("\\.");
        String tampered = parts[0] + "x" + "." + parts[1];

        assertThatThrownBy(() -> tokenService.verify(tampered, "sess_1"))
                .isInstanceOf(InvalidTokenException.class);
    }

    @Test
    void rejectsExpiredToken() {
        String token = tokenService.mint("sess_1", Role.HOST, null, Instant.now().minusSeconds(1));

        assertThatThrownBy(() -> tokenService.verify(token, "sess_1"))
                .isInstanceOf(InvalidTokenException.class);
    }

    @Test
    void rejectsSessionIdMismatch() {
        String token = tokenService.mint("sess_1", Role.HOST, null, Instant.now().plusSeconds(60));

        assertThatThrownBy(() -> tokenService.verify(token, "sess_2"))
                .isInstanceOf(InvalidTokenException.class);
    }

    @Test
    void verifyWithoutExpectedSessionSkipsSessionCheck() {
        String token = tokenService.mint("sess_1", Role.READ, "lnk_1", Instant.now().plusSeconds(60));

        TokenClaims claims = tokenService.verify(token);

        assertThat(claims.sessionId()).isEqualTo("sess_1");
    }
}
