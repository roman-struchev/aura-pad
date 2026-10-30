package com.struchev.auraserver.worktogether.ws;

import com.struchev.auraserver.worktogether.ConnectAuth;
import com.struchev.auraserver.worktogether.IdGenerator;
import com.struchev.auraserver.worktogether.Role;
import com.struchev.auraserver.worktogether.SessionService;
import com.struchev.auraserver.worktogether.model.WtConnection;
import com.struchev.auraserver.worktogether.model.WtSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

import java.nio.ByteBuffer;
import java.time.Instant;

/**
 * Relays Yjs sync (tag 0) and awareness (tag 1) binary frames between all
 * participants of a session, enforcing read-only per specification.md §4.1.
 * Control frames (tag 2) are server-originated only (§5) and never accepted
 * from clients.
 *
 * <p>Snapshot frames (tag 4, §4.4) are the one message a participant sends
 * that the backend does not relay but consumes: a write-capable client pushes
 * its full document state so the backend can replay it to a later
 * (re)connecting participant that no live peer is around to sync — the fix for
 * a reconnect landing on a blank document. The backend never decodes the Yjs
 * payload; it stores the framing-stripped remainder (itself a plain sync
 * message) verbatim and sends it back untouched, so a stock {@code
 * y-websocket} guest resyncs from it through its ordinary sync handling with
 * no snapshot-specific code.
 */
@Component
public class WorkTogetherWebSocketHandler extends AbstractWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(WorkTogetherWebSocketHandler.class);

    private static final int TAG_SYNC = 0;
    private static final int TAG_AWARENESS = 1;
    private static final int TAG_CONTROL = 2;
    // §4.4. Deliberately not tag 3 (y-websocket's queryAwareness) so a stock
    // y-websocket guest, which emits that on connect, can never be mistaken
    // for pushing a snapshot.
    private static final int TAG_SNAPSHOT = 4;
    // Yjs sync subtypes. Both step-2 and update carry document content (Yjs
    // applies each via applyUpdate); only step-1 is a content-free state-vector
    // request. A read-only participant may send step-1 (to pull the document)
    // but neither of the other two.
    private static final int SYNC_SUBTYPE_STEP2 = 1;
    private static final int SYNC_SUBTYPE_UPDATE = 2;

    private static final String ATTR_CONNECTION_ID = "wtConnectionId";

    private final SessionService sessionService;

    public WorkTogetherWebSocketHandler(SessionService sessionService) {
        this.sessionService = sessionService;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String sessionId = (String) session.getAttributes().get(WorkTogetherHandshakeInterceptor.ATTR_SESSION_ID);
        ConnectAuth auth = (ConnectAuth) session.getAttributes().get(WorkTogetherHandshakeInterceptor.ATTR_CONNECT_AUTH);
        String connectionId = IdGenerator.next("conn_");
        session.getAttributes().put(ATTR_CONNECTION_ID, connectionId);

        WebSocketSession sendSafeSession = new ConcurrentWebSocketSessionDecorator(session, 10_000, 512 * 1024);
        WtConnection connection = new WtConnection(connectionId, sessionId, auth.role(), auth.linkId(),
                Instant.now(), auth.displayName(), sendSafeSession);
        sessionService.registerConnection(connection);
        log.debug("Connection {} joined session {} as {}", connectionId, sessionId, auth.role());

        // Immediately resync the newcomer from the last cached full-state
        // snapshot, if any (§4.4). Sent unconditionally on connect - not in
        // response to the client's sync-step-1 - so the backend never has to
        // parse Yjs to recognise that request. The frame is already a plain
        // sync message, so the client applies it through its normal sync
        // handling; harmless if it turns out redundant (Y.applyUpdate is
        // idempotent) or if no other peer is online to have answered.
        WtSession wtSession = sessionService.findLiveSession(sessionId);
        if (wtSession != null) {
            byte[] snapshot = wtSession.latestSnapshot();
            if (snapshot != null) {
                try {
                    sendSafeSession.sendMessage(new BinaryMessage(snapshot));
                } catch (Exception e) {
                    log.debug("Failed to send snapshot to {}: {}", connectionId, e.getMessage());
                }
            }
        }
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) {
        String sessionId = (String) session.getAttributes().get(WorkTogetherHandshakeInterceptor.ATTR_SESSION_ID);
        String connectionId = (String) session.getAttributes().get(ATTR_CONNECTION_ID);
        ConnectAuth auth = (ConnectAuth) session.getAttributes().get(WorkTogetherHandshakeInterceptor.ATTR_CONNECT_AUTH);
        WtSession wtSession = sessionService.findLiveSession(sessionId);
        if (wtSession == null) {
            return;
        }

        ByteBuffer payload = message.getPayload();
        if (payload.remaining() < 1) {
            return;
        }
        int tag = payload.get(payload.position()) & 0xFF;

        if (tag == TAG_CONTROL) {
            return; // clients never send control frames
        }
        if (tag == TAG_SNAPSHOT) {
            storeSnapshot(wtSession, auth, connectionId, payload);
            return; // consumed by the backend, not relayed
        }
        if (tag == TAG_SYNC && auth.role() == Role.READ && payload.remaining() >= 2) {
            int subtype = payload.get(payload.position() + 1) & 0xFF;
            // Drop anything that carries document content (step-2 or update);
            // let step-1 through so a read-only guest can still pull the doc.
            if (subtype == SYNC_SUBTYPE_STEP2 || subtype == SYNC_SUBTYPE_UPDATE) {
                log.debug("Dropping sync subtype {} from read-only connection {}", subtype, connectionId);
                return; // specification.md §4.1: read-only writes are rejected server-side
            }
        }
        if (tag != TAG_SYNC && tag != TAG_AWARENESS) {
            return;
        }

        relay(wtSession, connectionId, message);
    }

    // A snapshot frame is [tag=4][a full sync message]. The backend stores the
    // remainder (everything after the tag byte) - which is already a valid
    // stand-alone sync message - and later sends it back verbatim on connect.
    // No Yjs decoding, only stripping one framing byte.
    private void storeSnapshot(WtSession wtSession, ConnectAuth auth, String connectionId, ByteBuffer payload) {
        if (auth.role() == Role.READ) {
            log.debug("Dropping snapshot from read-only connection {}", connectionId);
            return; // read-only participants can't define document state
        }
        if (payload.remaining() < 2) {
            return; // tag byte with no sync message after it
        }
        ByteBuffer body = payload.duplicate();
        body.position(body.position() + 1); // skip the snapshot tag
        byte[] frame = new byte[body.remaining()];
        body.get(frame);
        wtSession.setLatestSnapshot(frame);
    }

    private void relay(WtSession wtSession, String senderConnectionId, BinaryMessage message) {
        for (WtConnection connection : wtSession.connections()) {
            if (connection.connectionId().equals(senderConnectionId)) {
                continue;
            }
            try {
                if (connection.webSocketSession().isOpen()) {
                    connection.webSocketSession().sendMessage(message);
                }
            } catch (Exception e) {
                log.debug("Failed to relay message to {}: {}", connection.connectionId(), e.getMessage());
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String sessionId = (String) session.getAttributes().get(WorkTogetherHandshakeInterceptor.ATTR_SESSION_ID);
        String connectionId = (String) session.getAttributes().get(ATTR_CONNECTION_ID);
        if (sessionId != null && connectionId != null) {
            sessionService.unregisterConnection(sessionId, connectionId);
            log.debug("Connection {} left session {} ({})", connectionId, sessionId, status);
        }
    }
}
