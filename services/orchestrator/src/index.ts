/**
 * ARIA Orchestrator — main entry point.
 */

import dotenv from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from monorepo root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, "..", "..", "..", ".env");
dotenv.config({ path: envPath, override: true });

import Fastify from "fastify";
import { WebSocketServer } from "ws";
import pino from "pino";
import crypto from "node:crypto";

import { loadConfig } from "./config.js";
import { MemoryBroker } from "./memory/broker.js";
import { ReasoningCore } from "./reasoning/core.js";
import { VoiceSession } from "./voice/session.js";

const log = pino({
  level: process.env.ARIA_LOG_LEVEL ?? "info",
});

async function main() {
  const config = loadConfig();
  log.info({ version: config.aria.identity.version }, "ARIA booting");

  const memory = new MemoryBroker(process.env.ARIA_DB_PATH ?? "./data/aria.db");
  await memory.init();

  const reasoner = new ReasoningCore(config, memory, log);

  const app = Fastify({ logger: false });

  // ✅ Root route
  app.get("/", async () => {
    return { status: "ARIA is running 🚀" };
  });

  // ✅ Single health route (fixed)
  app.get("/health", async () => ({
    status: "ok",
    name: config.aria.identity.name,
    version: config.aria.identity.version,
  }));

  // Optional debug route
  
  app.post("/chat", async (req, reply) => {
  const { message } = req.body as any;

  try {
    const response = await (reasoner as any).ask?.(message)
  || await (reasoner as any).run?.(message)
  || "JARVIS is thinking...";
    return { reply: response };
  } catch (err) {
    return { reply: "Error talking to JARVIS" };
  }
});
  app.get("/memory/export", async () => {
    return memory.exportAll();
  });

  // ✅ Deploy-safe port config
  const port = Number(process.env.PORT || process.env.ARIA_PORT || 8787);
  const host = "0.0.0.0";

  await app.listen({ port, host });

  // WebSocket server
  const wss = new WebSocketServer({ server: app.server, path: "/voice" });

  wss.on("connection", (ws, req) => {
    const sessionId = crypto.randomUUID();

    log.info(
      { sessionId, ip: req.socket.remoteAddress },
      "voice session opened"
    );

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

  log.info(
    `ARIA listening on http://${host}:${port}  (voice: ws://${host}:${port}/voice)`
  );
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});