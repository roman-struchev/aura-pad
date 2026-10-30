package com.struchev.auraserver.worktogether.model;

import java.time.Instant;
import java.util.Collection;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * One shared tab: a live document (held as real Yjs state inside the Host's
 * and guests' own browser/Electron runtimes, not here — see specification.md's
 * note that the backend is a relay, not a durable store) plus its participants.
 *
 * <p>{@link #latestSnapshot} is the one exception: an in-memory-only cache of
 * the last full-state snapshot a write-capable participant pushed (§4.4). The
 * backend keeps it verbatim, as an already-framed Yjs sync-message it never
 * decodes, and replays it to any (re)connecting participant so a reconnect
 * works even when no other participant is currently online to answer the sync
 * handshake — see WorkTogetherWebSocketHandler. It is discarded with the rest
 * of the session on {@link #end()}, so it stays within specification.md §7's
 * "backend should not persist document content beyond a session's lifetime".
 */
public class WtSession {

    private final String sessionId;
    private final String filePath;
    private final String language;
    private final String content;
    private final Instant createdAt;
    private final long maxTtlSeconds;
    private final Instant expiresAt;
    private final AtomicBoolean ended = new AtomicBoolean(false);
    private final AtomicInteger guestCounter = new AtomicInteger(0);

    private final ConcurrentHashMap<String, WtLink> links = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, WtConnection> connections = new ConcurrentHashMap<>();

    // See class doc. An opaque, ready-to-send Yjs sync-message frame; null
    // until the first write-capable participant pushes one.
    private final AtomicReference<byte[]> latestSnapshot = new AtomicReference<>();

    public WtSession(String sessionId, String filePath, String language, String content,
                      Instant createdAt, long maxTtlSeconds, Instant expiresAt) {
        this.sessionId = sessionId;
        this.filePath = filePath;
        this.language = language;
        this.content = content;
        this.createdAt = createdAt;
        this.maxTtlSeconds = maxTtlSeconds;
        this.expiresAt = expiresAt;
    }

    public String sessionId() {
        return sessionId;
    }

    public String filePath() {
        return filePath;
    }

    public String language() {
        return language;
    }

    public String content() {
        return content;
    }

    public Instant createdAt() {
        return createdAt;
    }

    public long maxTtlSeconds() {
        return maxTtlSeconds;
    }

    public Instant expiresAt() {
        return expiresAt;
    }

    public boolean ended() {
        return ended.get();
    }

    /** @return true if this call actually transitioned the session to ended. */
    public boolean end() {
        return ended.compareAndSet(false, true);
    }

    public boolean isLive(Instant now) {
        return !ended.get() && now.isBefore(expiresAt);
    }

    /** Next sequential guest number for this session, used for default display names. */
    public int nextGuestNumber() {
        return guestCounter.incrementAndGet();
    }

    public void addLink(WtLink link) {
        links.put(link.linkId(), link);
    }

    public WtLink link(String linkId) {
        return links.get(linkId);
    }

    public Collection<WtLink> links() {
        return links.values();
    }

    public void addConnection(WtConnection connection) {
        connections.put(connection.connectionId(), connection);
    }

    public void removeConnection(String connectionId) {
        connections.remove(connectionId);
    }

    public Collection<WtConnection> connections() {
        return connections.values();
    }

    /** Replaces the cached full-state snapshot with a newer one pushed by a write-capable participant. */
    public void setLatestSnapshot(byte[] frame) {
        latestSnapshot.set(frame);
    }

    /** The last full-state snapshot to replay to a (re)connecting participant, or {@code null} if none yet. */
    public byte[] latestSnapshot() {
        return latestSnapshot.get();
    }
}
