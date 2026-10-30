package com.struchev.auraserver.worktogether.model;

import com.struchev.auraserver.worktogether.Role;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * A minted, shareable link on a {@link WtSession}. Carries its own role and
 * expiry (specification.md §2, §3.2).
 */
public class WtLink {

    private final String linkId;
    private final String sessionId;
    private final Role role;
    private final Instant createdAt;
    private final Instant expiresAt;
    private final AtomicBoolean revoked = new AtomicBoolean(false);

    public WtLink(String linkId, String sessionId, Role role, Instant createdAt, Instant expiresAt) {
        this.linkId = linkId;
        this.sessionId = sessionId;
        this.role = role;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
    }

    public String linkId() {
        return linkId;
    }

    public String sessionId() {
        return sessionId;
    }

    public Role role() {
        return role;
    }

    public Instant createdAt() {
        return createdAt;
    }

    public Instant expiresAt() {
        return expiresAt;
    }

    public boolean revoked() {
        return revoked.get();
    }

    /** @return true if this call actually transitioned the link to revoked (false if already revoked). */
    public boolean revoke() {
        return revoked.compareAndSet(false, true);
    }

    public boolean isLive(Instant now) {
        return !revoked.get() && now.isBefore(expiresAt);
    }
}
