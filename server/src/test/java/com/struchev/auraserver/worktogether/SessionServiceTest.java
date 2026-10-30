package com.struchev.auraserver.worktogether;

import tools.jackson.databind.ObjectMapper;
import com.struchev.auraserver.worktogether.dto.CreateSessionRequest;
import com.struchev.auraserver.worktogether.dto.CreateSessionResponse;
import com.struchev.auraserver.worktogether.dto.MintLinkRequest;
import com.struchev.auraserver.worktogether.dto.MintLinkResponse;
import com.struchev.auraserver.worktogether.dto.SessionStatusResponse;
import com.struchev.auraserver.worktogether.exception.BadRequestException;
import com.struchev.auraserver.worktogether.exception.CapacityExceededException;
import com.struchev.auraserver.worktogether.exception.RateLimitExceededException;
import com.struchev.auraserver.worktogether.model.WtSession;
import com.struchev.auraserver.worktogether.exception.NotFoundException;
import com.struchev.auraserver.worktogether.exception.ValidationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SessionServiceTest {

    // Small numbers so each cap is easy to hit: 100-byte files, a 300-byte budget, 3 sessions per address.
    private static final SessionLimits LIMITS = new SessionLimits(100, 1024, 300, 3);

    private SessionService sessionService;

    @BeforeEach
    void setUp() {
        TokenService tokenService = new TokenService(new ObjectMapper(), "test-secret");
        sessionService = new SessionService(tokenService, new ObjectMapper(), 86_400, LIMITS);
    }

    private CreateSessionResponse createSession() {
        return sessionService.createSession(
                new CreateSessionRequest("src/App.tsx", "typescript", "const x = 1;", 3600L), "10.0.0.1");
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

    // ---- size caps (SessionLimits) ----

    private CreateSessionResponse createSession(String content, String clientIp) {
        return sessionService.createSession(
                new CreateSessionRequest("a.txt", "plaintext", content, 3600L), clientIp);
    }

    @Test
    void fileOverTheContentCapIsRefused() {
        assertThatThrownBy(() -> createSession("x".repeat(101), "10.0.0.1"))
                .isInstanceOf(ValidationException.class);
        assertThat(sessionService.usedBytes()).isZero();
    }

    @Test
    void oneAddressCanHoldOnlySoManyLiveSessions() {
        for (int i = 0; i < 3; i++) {
            createSession("x", "10.0.0.1");
        }

        assertThatThrownBy(() -> createSession("x", "10.0.0.1"))
                .isInstanceOf(RateLimitExceededException.class);
        // Another address is unaffected, and ending a session frees a slot.
        CreateSessionResponse other = createSession("x", "10.0.0.2");
        sessionService.endSession(other.sessionId());
    }

    @Test
    void newSessionsAreRefusedOnceTheMemoryBudgetIsUsedUp() {
        createSession("x".repeat(100), "10.0.0.1");
        createSession("x".repeat(100), "10.0.0.2");
        CreateSessionResponse third = createSession("x".repeat(100), "10.0.0.3");

        assertThatThrownBy(() -> createSession("x", "10.0.0.4"))
                .isInstanceOf(CapacityExceededException.class);

        sessionService.endSession(third.sessionId());
        createSession("x", "10.0.0.4");
    }

    @Test
    void snapshotsCountAgainstTheBudgetAndAreReleasedWithTheSession() {
        CreateSessionResponse response = createSession("x".repeat(10), "10.0.0.1");
        WtSession session = sessionService.findLiveSession(response.sessionId());

        sessionService.storeSnapshot(session, new byte[200]);
        assertThat(sessionService.usedBytes()).isEqualTo(210);

        // Would take the total past 300: dropped, the previous snapshot stays.
        sessionService.storeSnapshot(session, new byte[300]);
        assertThat(session.latestSnapshot()).hasSize(200);
        assertThat(sessionService.usedBytes()).isEqualTo(210);

        // A smaller one replaces it and gives the difference back.
        sessionService.storeSnapshot(session, new byte[50]);
        assertThat(sessionService.usedBytes()).isEqualTo(60);

        sessionService.endSession(response.sessionId());
        assertThat(sessionService.usedBytes()).isZero();
        sessionService.storeSnapshot(session, new byte[50]);
        assertThat(sessionService.usedBytes()).isZero();
    }
}
