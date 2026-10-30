package com.struchev.auraserver.worktogether;

import com.struchev.auraserver.worktogether.guest.GuestPageController;
import com.struchev.auraserver.worktogether.model.WtLink;
import com.struchev.auraserver.worktogether.model.WtSession;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.view;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.model;

@WebMvcTest(GuestPageController.class)
class GuestPageControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private TokenService tokenService;

    @MockitoBean
    private SessionService sessionService;

    @MockitoBean
    private RateLimiter rateLimiter;

    @Test
    void rateLimiterExceededReturnsErrorPage() throws Exception {
        when(rateLimiter.tryAcquire(any())).thenReturn(false);

        mockMvc.perform(get("/j/some-link-id"))
                .andExpect(status().isOk())
                .andExpect(view().name("worktogether/error-template"))
                .andExpect(model().attribute("message", "Too many attempts — please try again in a minute."));
    }

    @Test
    void invalidLinkReturnsErrorPage() throws Exception {
        when(rateLimiter.tryAcquire(any())).thenReturn(true);
        when(sessionService.resolveGuestLink("invalid-id")).thenReturn(null);

        mockMvc.perform(get("/j/invalid-id"))
                .andExpect(status().isOk())
                .andExpect(view().name("worktogether/error-template"))
                .andExpect(model().attribute("message", "This link is invalid."));
    }

    @Test
    void activeLinkRendersGuestTemplate() throws Exception {
        when(rateLimiter.tryAcquire(any())).thenReturn(true);

        WtSession session = new WtSession("session-123", "src/index.js", "javascript", "console.log('hello');", Instant.now(), 3600L, Instant.now().plusSeconds(3600));
        WtLink link = new WtLink("link-123", "session-123", Role.READ, Instant.now(), Instant.now().plusSeconds(1800));
        GuestLinkContext ctx = new GuestLinkContext(session, link);

        when(sessionService.resolveGuestLink("link-123")).thenReturn(ctx);
        when(tokenService.mint(eq("session-123"), eq(Role.READ), eq("link-123"), any())).thenReturn("mock-ws-token");

        mockMvc.perform(get("/j/link-123"))
                .andExpect(status().isOk())
                .andExpect(view().name("worktogether/guest-template"))
                .andExpect(model().attribute("sessionId", "session-123"))
                .andExpect(model().attribute("token", "mock-ws-token"))
                .andExpect(model().attribute("role", "read"))
                .andExpect(model().attribute("language", "javascript"))
                .andExpect(model().attribute("filePath", "src/index.js"))
                .andExpect(model().attribute("initialContent", "console.log('hello');"));
    }
}
