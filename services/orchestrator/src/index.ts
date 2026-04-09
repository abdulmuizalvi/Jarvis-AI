/**
 * ARIA Orchestrator — main entry point.
 *
 * Boots:
 *  - Fastify HTTP server (session bootstrap, health)
 *  - WebSocket endpoint for full-duplex voice sessions
 *  - Memory broker (SQLite)
 *  - Reasoning core (Claude)
 *  - Voice pipeline (Deepgram + ElevenLabs)
 */

import dotenv from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Load .env from the monorepo root (three levels up from src/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, "..", "..", "..", ".env");
// override: true — .env is authoritative in this dev setup, even when the
// ambient shell has stale/empty values for the same key (common on Windows).
dotenv.config({ path: envPath, override: true });

import Fastify from "fastify";
import { WebSocketServer } from "ws";
import pino from "pino";
import { loadConfig } from "./config.js";
import { MemoryBroker } from "./memory/broker.js";
import { ReasoningCore } from "./reasoning/core.js";
import { VoiceSession } from "./voice/session.js";

const log = pino({
  level: process.env.ARIA_LOG_LEVEL ?? "info",
  // Synchronous JSON logging — no worker transport, no buffering.
});

async function main() {
  const config = loadConfig();
  log.info({ version: config.aria.identity.version }, "ARIA booting");

  const memory = new MemoryBroker(process.env.ARIA_DB_PATH ?? "./data/aria.db");
  await memory.init();

  const reasoner = new ReasoningCore(config, memory, log);

  const app = Fastify({ logger: false });

  app.get("/health", async () => ({
    status: "ok",
    name: config.aria.identity.name,
    version: config.aria.identity.version,
  }));

  app.get("/memory/export", async () => {
    return memory.exportAll();
  });

  const port = Number(process.env.ARIA_PORT ?? 8787);
  const host = process.env.ARIA_HOST ?? "127.0.0.1";
  await app.listen({ port, host });

  const wss = new WebSocketServer({ server: app.server, path: "/voice" });

  wss.on("connection", (ws, req) => {
    const sessionId = crypto.randomUUID();
    log.info({ sessionId, ip: req.socket.remoteAddress }, "voice session opened");

    const session = new VoiceSession({
      id: sessionId,
      ws,
      config,
      memory,
      reasoner,
      logger: log.child({ sessionId }),
    });

    session.start().catch((err) => {
      log.error({ err, sessionId }, "session crashed");
      ws.close(1011, "internal error");
    });

    ws.on("close", () => {
      log.info({ sessionId }, "voice session closed");
      session.stop();
    });
  });

  log.info(`ARIA listening on http://${host}:${port}  (voice: ws://${host}:${port}/voice)`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
