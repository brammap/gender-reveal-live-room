const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const root = __dirname;
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webm": "video/webm",
  ".gif": "image/gif",
};

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { clients: new Map(), history: [] });
  }
  return rooms.get(roomId);
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(roomId, message) {
  const room = getRoom(roomId);
  room.history.push(message);
  if (room.history.length > 1000) room.history.shift();
  for (const client of room.clients.values()) {
    sendEvent(client.res, "message", message);
  }
}

function serveFile(res, filePath, extraHeaders = {}) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
      ...extraHeaders,
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/events") {
    const roomId = url.searchParams.get("room") || "reveal-room";
    const clientId = url.searchParams.get("client") || randomUUID();
    const room = getRoom(roomId);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("\n");

    room.clients.set(clientId, { res });
    for (const message of room.history) {
      sendEvent(res, "message", message);
    }

    req.on("close", () => {
      room.clients.delete(clientId);
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/message") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const message = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (!message.room || !message.type) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing room or type" }));
          return;
        }
        message.id = message.id || randomUUID();
        message.time = Date.now();
        broadcast(message.room, message);
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const isGuest = url.searchParams.has("guest");
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;

  if (isGuest && (pathname === "/index.html" || pathname === "/" || pathname === "/host.html")) {
    serveFile(res, path.join(root, "guest.html"));
    return;
  }

  if (!isGuest && (pathname === "/index.html" || pathname === "/")) {
    serveFile(res, path.join(root, "host.html"));
    return;
  }

  const filePath = path.join(root, pathname);
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  serveFile(res, filePath);
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Reveal room running at http://localhost:${port}`);
});
