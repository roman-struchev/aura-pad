package com.struchev.auraserver.worktogether;

import tools.jackson.databind.ObjectMapper;
import com.struchev.auraserver.worktogether.dto.CreateSessionRequest;
import com.struchev.auraserver.worktogether.dto.CreateSessionResponse;
import com.struchev.auraserver.worktogether.dto.MintLinkRequest;
import com.struchev.auraserver.worktogether.dto.MintLinkResponse;
import com.struchev.auraserver.worktogether.dto.SessionStatusResponse;
import com.struchev.auraserver.worktogether.exception.BadRequestException;
import com.struchev.auraserver.worktogether.exception.NotFoundException;
import com.struchev.auraserver.worktogether.exception.ValidationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SessionServiceTest {

    private SessionService sessionService;

    @BeforeEach
    void setUp() {
        TokenService tokenService = new TokenService(new ObjectMapper(), "test-secret");
        sessionService = new SessionService(tokenService, new ObjectMapper(), 86_400);
    }

    private CreateSessionResponse createSession() {
        return sessionService.createSession(
                new CreateSessionRequest("src/App.tsx", "typescript", "const x = 1;", 3600L));
    }

    @Test
    void createSessionReturnsHostTokenAndExpiry() {
        CreateSessionResponse response = createSession();

        assertThat(response.sessionId()).startsWith("sess_");
        assertThat(response.hostToken()).isNotBlank();
        assertThat(response.expiresAt()).isNotNull();

        ConnectAuth auth = sessionService.resolveConnectAuth(response.sessionId(), response.hostToken());
        assertThat(auth.role()).isEqualTo(Role.HOST);
    }

    @Test
    void mintLinkRejectsTtlAboveSessionCeiling() {
        CreateSessionResponse session = createSession();

        assertThatThrownBy(() -> sessionService.mintLink(session.sessionId(),
                new MintLinkRequest(Role.READ, 7200L), "https://example.com"))
                .isInstanceOf(ValidationException.class);
    }

    @Test
    void mintLinkRejectsHostRole() {
        CreateSessionResponse session = createSession();

        assertThatThrownBy(() -> sessionService.mintLink(session.sessionId(),
                new MintLinkRequest(Role.HOST, 60L), "https://example.com"))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void mintLinkProducesJoinableUrlAndConnectAuth() {
        CreateSessionResponse session = createSession();

        MintLinkResponse link = sessionService.mintLink(session.sessionId(),
                new MintLinkRequest(Role.READ, 60L), "https://example.com");

        assertThat(link.url()).isEqualTo("https://example.com/j/" + link.linkId());
        ConnectAuth auth = sessionService.resolveConnectAuth(session.sessionId(), link.token());
        assertThat(auth.role()).isEqualTo(Role.READ);
        assertThat(auth.linkId()).isEqualTo(link.linkId());
    }

    @Test
    void guestLinkResolvesToSessionAndLink() {
        CreateSessionResponse session = createSession();
        MintLinkResponse link = sessionService.mintLink(session.sessionId(),
                new MintLinkRequest(Role.WRITE, 60L), "https://example.com");

        GuestLinkContext ctx = sessionService.resolveGuestLink(link.linkId());

        assertThat(ctx).isNotNull();
        assertThat(ctx.session().sessionId()).isEqualTo(session.sessionId());
        assertThat(ctx.link().linkId()).isEqualTo(link.linkId());
    }

    @Test
    void unknownGuestLinkResolvesToNull() {
        assertThat(sessionService.resolveGuestLink("lnk_does-not-exist")).isNull();
    }

    @Test
    void revokedLinkCannotBeUsedToConnect() {
        CreateSessionResponse session = createSession();
        MintLinkResponse link = sessionService.mintLink(session.sessionId(),
                new MintLinkRequest(Role.WRITE, 60L), "https://example.com");

        sessionService.revokeLink(session.sessionId(), link.linkId());

        assertThatThrownBy(() -> sessionService.resolveConnectAuth(session.sessionId(), link.token()))
                .isInstanceOf(com.struchev.auraserver.worktogether.exception.InvalidTokenException.class);
    }

    @Test
    void endedSessionRejectsFurtherConnectAttempts() {
        CreateSessionResponse session = createSession();

        sessionService.endSession(session.sessionId());

        assertThatThrownBy(() -> sessionService.resolveConnectAuth(session.sessionId(), session.hostToken()))
                .isInstanceOf(com.struchev.auraserver.worktogether.exception.InvalidTokenException.class);
        assertThatThrownBy(() -> sessionService.getStatus(session.sessionId()))
                .isInstanceOf(NotFoundException.class);
    }

    @Test
    void statusReflectsMintedLinks() {
        CreateSessionResponse session = createSession();
        sessionService.mintLink(session.sessionId(), new MintLinkRequest(Role.READ, 60L), "https://example.com");

        SessionStatusResponse status = sessionService.getStatus(session.sessionId());

        assertThat(status.links()).hasSize(1);
        assertThat(status.links().get(0).role()).isEqualTo(Role.READ);
    }
}
