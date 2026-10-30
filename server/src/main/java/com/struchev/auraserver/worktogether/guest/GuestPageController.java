package com.struchev.auraserver.worktogether.guest;

import com.struchev.auraserver.worktogether.ClientIp;
import com.struchev.auraserver.worktogether.GuestLinkContext;
import com.struchev.auraserver.worktogether.RateLimiter;
import com.struchev.auraserver.worktogether.SessionService;
import com.struchev.auraserver.worktogether.TokenService;
import com.struchev.auraserver.worktogether.model.WtLink;
import com.struchev.auraserver.worktogether.model.WtSession;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

import java.time.Instant;

/**
 * Serves the guest-facing collaborative editor page a share link resolves to
 * (specification.md §6). The URL only carries the link's short id, not the
 * full signed token - much shorter to share, and just as unguessable since
 * the id itself is high-entropy random (see SessionService#mintLink). This
 * controller resolves that id back to its session/link and mints an
 * equivalent WS token on the fly.
 */
@Controller
public class GuestPageController {

    private final TokenService tokenService;
    private final SessionService sessionService;
    private final RateLimiter rateLimiter;

    public GuestPageController(TokenService tokenService, SessionService sessionService,
                                RateLimiter rateLimiter) {
        this.tokenService = tokenService;
        this.sessionService = sessionService;
        this.rateLimiter = rateLimiter;
    }

    @GetMapping("/j/{linkId}")
    public String joinSession(@PathVariable String linkId, HttpServletRequest servletRequest, Model model) {
        // linkId is short (see SessionService#mintLink) precisely because this endpoint
        // is rate-limited - a brute-force guesser is bounded to the same per-minute
        // budget as everyone else, regardless of how many ids they try.
        if (!rateLimiter.tryAcquire("join:" + ClientIp.of(servletRequest))) {
            model.addAttribute("message", "Too many attempts — please try again in a minute.");
            return "worktogether/error-template";
        }
        GuestLinkContext ctx = sessionService.resolveGuestLink(linkId);
        if (ctx == null) {
            model.addAttribute("message", "This link is invalid.");
            return "worktogether/error-template";
        }
        WtSession session = ctx.session();
        WtLink link = ctx.link();
        if (session.ended()) {
            model.addAttribute("message", "This session has ended.");
            return "worktogether/error-template";
        }
        if (link.revoked()) {
            model.addAttribute("message", "This link was revoked by the host.");
            return "worktogether/error-template";
        }
        if (Instant.now().isAfter(link.expiresAt())) {
            model.addAttribute("message", "This link has expired.");
            return "worktogether/error-template";
        }

        String wsToken = tokenService.mint(session.sessionId(), link.role(), link.linkId(), link.expiresAt());

        model.addAttribute("sessionId", session.sessionId());
        model.addAttribute("token", wsToken);
        model.addAttribute("role", link.role().value());
        model.addAttribute("language", session.language());
        model.addAttribute("filePath", session.filePath());
        model.addAttribute("initialContent", session.content());

        return "worktogether/guest-template";
    }
}
