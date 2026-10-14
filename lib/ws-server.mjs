import { createHash } from "node:crypto";
import { createServer } from "node:http";

/**
 * A small WebSocket server (RFC 6455) over Node's own http and crypto, for
 * the agent bridge's attach mode (roadmap v11, wave 5): one text message
 * at a time each way, the client's frames masked as browsers send them,
 * fragments joined, pings answered, a close closed. No extension, no
 * binary messages — the bridge speaks JSON. Listens on 127.0.0.1 only, and
 * refuses a handshake whose Origin the caller does not allow.
 */

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** The largest message taken: a 4K export as a data URL fits with room. */
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

function frame(opcode, payload) {
  const length = payload.length;
  const head = length < 126 ? Buffer.alloc(2) : length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);

  head[0] = 0x80 | opcode;

  if (length < 126) {
    head[1] = length;
  } else if (length < 65536) {
    head[1] = 126;
    head.writeUInt16BE(length, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([head, payload]);
}

/** One connection: `send(text)`, `close()`, and `onMessage` / `onClose` to set. */
function connection(socket) {
  let buffer = Buffer.alloc(0);
  let fragments = [];
  let closed = false;
  const peer = {
    close() {
      if (!closed) {
        closed = true;
        socket.end(frame(0x8, Buffer.alloc(0)));
      }
    },
    onClose: () => {},
    onMessage: () => {},
    send(text) {
      if (!closed) {
        socket.write(frame(0x1, Buffer.from(text, "utf8")));
      }
    },
  };

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    for (;;) {
      if (buffer.length < 2) {
        return;
      }

      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (buffer.length < 4) {
          return;
        }

        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) {
          return;
        }

        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      if (length > MAX_MESSAGE_BYTES) {
        peer.close();
        socket.destroy();
        return;
      }

      const maskOffset = offset;

      if (masked) {
        offset += 4;
      }

      if (buffer.length < offset + length) {
        return;
      }

      const payload = Buffer.from(buffer.subarray(offset, offset + length));

      if (masked) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= buffer[maskOffset + (index % 4)];
        }
      }

      buffer = buffer.subarray(offset + length);

      if (opcode === 0x8) {
        peer.close();
        return;
      }

      if (opcode === 0x9) {
        socket.write(frame(0xa, payload));
        continue;
      }

      if (opcode === 0xa) {
        continue;
      }

      // Text, or a continuation of it; binary is not spoken here.
      if (opcode === 0x1 || opcode === 0x0) {
        fragments.push(payload);

        if (fin) {
          const text = Buffer.concat(fragments).toString("utf8");

          fragments = [];
          peer.onMessage(text);
        }
      }
    }
  });
  socket.on("close", () => {
    closed = true;
    peer.onClose();
  });
  socket.on("error", () => {
    closed = true;
  });

  return peer;
}

/**
 * Listens on 127.0.0.1:`port`; each accepted connection is handed to
 * `onConnection(peer, request)`. A handshake whose Origin `allowOrigin`
 * refuses gets a 403 and no socket.
 */
export function serveWebSocket({ allowOrigin, onConnection, port }) {
  const server = createServer((_request, response) => {
    response.writeHead(426, { "content-type": "text/plain" });
    response.end("A WebSocket endpoint.");
  });

  server.on("upgrade", (request, socket) => {
    const key = request.headers["sec-websocket-key"];
    const origin = request.headers.origin ?? "";

    if (typeof key !== "string" || (request.headers.upgrade ?? "").toLowerCase() !== "websocket" || !allowOrigin(origin)) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }

    const accept = createHash("sha1").update(key + GUID).digest("base64");

    socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, "", ""].join("\r\n"));
    onConnection(connection(socket), request);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
