package com.struchev.auraserver.worktogether;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The real server on a real port: HTTP API, WebSocket relay, Tomcat's frame and
 * proxy-header handling - the parts unit tests with mocks can't see.
 * Each test sends its own X-Forwarded-For client address, so the per-address
 * rate limits of one test don't spill into another.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class WorkTogetherEndToEndTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private final HttpClient http = HttpClient.newHttpClient();

    @LocalServerPort
    private int port;

    @Test
    void aSnapshotBiggerThanTomcatsDefaultFrameSizeReachesALaterGuest() throws Exception {
        JsonNode session = createSession("x", "203.0.113.1");
        String sessionId = session.get("sessionId").asString();
        Client host = connect(sessionId, session.get("hostToken").asString());

        // [snapshot tag][a 20 KB sync message] - well past Tomcat's 8 KB default.
        byte[] sync = new byte[20_000];
        sync[1] = 2;
        byte[] frame = new byte[sync.length + 1];
        frame[0] = 4;
        System.arraycopy(sync, 0, frame, 1, sync.length);
        host.socket.sendBinary(ByteBuffer.wrap(frame), true).get(5, TimeUnit.SECONDS);

        String guestToken = mintLink(sessionId, session.get("hostToken").asString()).get("token").asString();
        Client guest = connect(sessionId, guestToken);

        // The guest is resynced from the cached snapshot, and the host is still connected.
        assertThat(guest.nextRelayed()).isEqualTo(sync);
        byte[] awareness = { 1, 9, 9 };
        guest.socket.sendBinary(ByteBuffer.wrap(awareness), true).get(5, TimeUnit.SECONDS);
        assertThat(host.nextRelayed()).isEqualTo(awareness);
        assertThat(host.closed).isNotDone();
    }

    @Test
    void anOversizedRequestBodyIsRefusedBeforeItIsRead() throws Exception {
        // Tomcat answers 413 and, rather than drain megabytes it won't use, drops
        // the connection - so the client sees either the 413 or the reset.
        try {
            assertThat(postSession("x".repeat(3 * 1024 * 1024), "203.0.113.2").statusCode()).isEqualTo(413);
        } catch (java.io.IOException refused) {
            // connection closed by the server mid-upload
        }
    }

    @Test
    void aFileOverTheShareLimitIsRefused() throws Exception {
        HttpResponse<String> response = postSession("x".repeat(1024 * 1024 + 1), "203.0.113.3");

        assertThat(response.statusCode()).isEqualTo(422);
    }

    @Test
    void theRateLimitKeysOnTheAddressTheProxyAddedNotOneTheClientSent() throws Exception {
        // The test client connects from localhost, i.e. as a trusted local proxy would.
        // Its last X-Forwarded-For hop is the client; earlier hops are client-supplied.
        for (int i = 0; i < 30; i++) {
            assertThat(join("198.51.100." + i + ", 203.0.113.4")).contains("This link is invalid");
        }
        assertThat(join("198.51.100.200, 203.0.113.4")).contains("Too many attempts");
        assertThat(join("203.0.113.5")).contains("This link is invalid");
    }

    // ---- helpers ----

    private HttpResponse<String> postSession(String content, String clientIp) throws Exception {
        String body = JSON.writeValueAsString(Map.of("filePath", "a.txt", "language", "plaintext",
                "content", content, "maxTtlSeconds", 3600));
        return http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/v1/sessions"))
                        .header("Content-Type", "application/json")
                        .header("X-Forwarded-For", clientIp)
                        .POST(HttpRequest.BodyPublishers.ofString(body)).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private JsonNode createSession(String content, String clientIp) throws Exception {
        HttpResponse<String> response = postSession(content, clientIp);
        assertThat(response.statusCode()).isEqualTo(201);
        return JSON.readTree(response.body());
    }

    private JsonNode mintLink(String sessionId, String hostToken) throws Exception {
        HttpResponse<String> response = http.send(HttpRequest.newBuilder(
                                URI.create("http://localhost:" + port + "/v1/sessions/" + sessionId + "/links"))
                        .header("Content-Type", "application/json")
                        .header("Authorization", "Bearer " + hostToken)
                        .POST(HttpRequest.BodyPublishers.ofString("{\"role\":\"write\",\"ttlSeconds\":600}")).build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(201);
        return JSON.readTree(response.body());
    }

    private String join(String forwardedFor) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/j/doesNotExist"))
                        .header("X-Forwarded-For", forwardedFor).GET().build(),
                HttpResponse.BodyHandlers.ofString()).body();
    }

    private Client connect(String sessionId, String token) throws Exception {
        Client client = new Client();
        client.socket = http.newWebSocketBuilder()
                .buildAsync(URI.create("ws://localhost:" + port + "/v1/sessions/" + sessionId + "/connect?token=" + token),
                        client)
                .get(5, TimeUnit.SECONDS);
        return client;
    }

    /** Collects whole binary messages (the JDK may hand them over in parts) and the close code. */
    private static final class Client implements WebSocket.Listener {
        final BlockingQueue<byte[]> messages = new LinkedBlockingQueue<>();
        final CompletableFuture<Integer> closed = new CompletableFuture<>();
        private final ByteArrayOutputStream partial = new ByteArrayOutputStream();
        WebSocket socket;

        /** Next sync/awareness message, skipping the server's own control frames (tag 2). */
        byte[] nextRelayed() throws InterruptedException {
            while (true) {
                byte[] message = messages.poll(5, TimeUnit.SECONDS);
                if (message == null || message[0] != 2) {
                    return message;
                }
            }
        }

        @Override
        public CompletionStage<?> onBinary(WebSocket webSocket, ByteBuffer data, boolean last) {
            byte[] chunk = new byte[data.remaining()];
            data.get(chunk);
            partial.writeBytes(chunk);
            if (last) {
                messages.add(partial.toByteArray());
                partial.reset();
            }
            webSocket.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            closed.complete(statusCode);
            return null;
        }
    }
}
