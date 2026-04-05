#!/usr/bin/env node
/**
 * entity-learn HUD server — serves vanilla JS canvas + proxies to entity-learn render.
 * Zero framework. ~30 lines. Replace with merjs later.
 */

import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dir = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(__dir, "public");
const EL = join(__dir, "..", "bin", "entity-learn.mjs");
const PORT = parseInt(process.argv[2] ?? "3001");

const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json" };

const server = createServer((req, res) => {
  // API: proxy to entity-learn render
  if (req.method === "POST" && req.url === "/api/ui") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { prompt } = JSON.parse(body);
        const out = execSync(`node "${EL}" render "${(prompt ?? "init").replace(/"/g, '\\"')}"`, {
          encoding: "utf-8",
          timeout: 30_000,
        });
        res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-cache" });
        res.end(out);
      } catch (e) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(e.message);
      }
    });
    return;
  }

  // Static files
  const file = req.url === "/" ? "/index.html" : req.url;
  const path = join(PUBLIC, file);
  if (existsSync(path)) {
    const ext = extname(path);
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
    res.end(readFileSync(path));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`entity-learn HUD → http://localhost:${PORT}`);
});
