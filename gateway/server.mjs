import http from "node:http";
import net from "node:net";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, extname, sep } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { Framer, frame } from "./framing.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 8080);
const bind = process.env.BIND || "127.0.0.1";
const targetHost = process.env.YUROTS_HOST || "127.0.0.1";
const targetPort = Number(process.env.YUROTS_PORT || 7171);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};
const server = http.createServer(async (req, res) => {
  try {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405).end();
      return;
    }
    const path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (path === "/health") {
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ ok: true, protocol: 760 }));
      return;
    }
    const relative = path === "/" ? "yurots.html" : path.slice(1);
    // Serve only client assets; never the repository, gateway source or local state.
    if (
      !/^(yurots\.html|index\.html|(?:yurots|src|css|png|sounds|data)\/[^.][^\0]*)$/.test(
        relative,
      ) ||
      relative.split("/").some((p) => p.startsWith("."))
    ) {
      res.writeHead(404).end();
      return;
    }
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404).end("Not found");
  }
});
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 16766,
  perMessageDeflate: false,
});
server.on("upgrade", (req, socket, head) => {
  const origins = process.env.PUBLIC_ORIGIN
    ? [process.env.PUBLIC_ORIGIN]
    : [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  if (
    !["/login", "/game"].includes(req.url) ||
    !origins.includes(req.headers.origin)
  ) {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
wss.on("connection", (ws, req) => {
  // The browser cannot choose the destination: this is not an open TCP proxy.
  const tcp = net.createConnection({ host: targetHost, port: targetPort });
  tcp.setNoDelay(true);
  tcp.setTimeout(120000);
  const close = () => {
    tcp.destroy();
    if (ws.readyState === WebSocket.OPEN) ws.close();
  };
  const parser = new Framer((packet) => {
    if (ws.bufferedAmount > 1024 * 1024) return close();
    if (ws.readyState === WebSocket.OPEN) ws.send(packet);
  });
  let first = true;
  ws.on("message", (payload, binary) => {
    try {
      if (!binary) throw new Error("Binary messages required");
      if (first && payload[0] !== (req.url === "/login" ? 0x01 : 0x0a))
        throw new Error("Wrong handshake");
      first = false;
      if (tcp.writableLength > 1024 * 1024)
        throw new Error("Backpressure limit");
      tcp.write(frame(payload));
    } catch {
      close();
    }
  });
  tcp.on("data", (chunk) => {
    try {
      parser.push(chunk);
    } catch {
      close();
    }
  });
  tcp.on("end", close);
  tcp.on("error", close);
  tcp.on("timeout", close);
  ws.on("close", () => tcp.destroy());
  ws.on("error", close);
});
server.listen(port, bind, () =>
  console.log(
    `YurOTS browser: http://${bind}:${port} → ${targetHost}:${targetPort}`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    for (const ws of wss.clients) ws.terminate();
    server.close(() => process.exit(0));
  });
