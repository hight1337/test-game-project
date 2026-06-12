import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { DEFAULT_PORT } from "@f1web/shared";
import { RoomManager } from "./rooms";

const port = Number(process.env.PORT) || DEFAULT_PORT;

// serve the built client (client/dist) if present, so one deployment hosts
// both the game and the WebSocket endpoint on the same origin
const clientDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "client",
  "dist",
);
const hasClient = existsSync(path.join(clientDist, "index.html"));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const server = http.createServer((req, res) => {
  if (!hasClient) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("f1web race server ok\n");
    return;
  }
  const url = (req.url ?? "/").split("?")[0];
  // resolve inside dist only; anything unknown falls back to index.html
  const safe = path.normalize(url).replace(/^(\.\.[/\\])+/, "");
  let file = path.join(clientDist, safe === "/" || safe === "\\" ? "index.html" : safe);
  if (!file.startsWith(clientDist) || !existsSync(file) || statSync(file).isDirectory()) {
    file = path.join(clientDist, "index.html");
  }
  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const cache = file.includes(`${path.sep}assets${path.sep}`)
    ? "public, max-age=31536000, immutable" // hashed filenames
    : "no-cache";
  res.writeHead(200, { "content-type": type, "cache-control": cache });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server });
const manager = new RoomManager();

wss.on("connection", (ws) => manager.handleConnection(ws));

// drop dead connections (closed laptops, lost wifi)
setInterval(() => {
  for (const ws of wss.clients) {
    const alive = (ws as unknown as { isAlive?: boolean }).isAlive;
    if (alive === false) {
      ws.terminate();
      continue;
    }
    (ws as unknown as { isAlive: boolean }).isAlive = false;
    ws.ping();
  }
}, 15_000);

server.listen(port, () => {
  console.log(
    `[f1web] race server listening on port ${port}` +
      (hasClient ? " (serving client build)" : ""),
  );
});
