# ARIA — Autonomous Reasoning & Intelligence Assistant

> *"A real JARVIS, built with today's technology."*

ARIA is a voice-first, always-present intelligent assistant designed to reason, remember, act, and feel alive. This repository contains the Phase 1 MVP scaffold — a working voice loop wired end-to-end.

---

## Architecture (Phase 1 MVP)

```
┌───────────────────┐    WebSocket    ┌─────────────────────┐
│  Electron HUD     │ <─────────────> │  Orchestrator (Node)│
│  (React + WebGL)  │   audio frames  │  - ASR (Deepgram)   │
└───────────────────┘                 │  - Reasoning (Claude)│
                                      │  - TTS (ElevenLabs) │
                                      │  - Memory (SQLite)  │
                                      │  - Agent / Tools    │
                                      └─────────────────────┘
```

## Stack

| Layer          | Tech                                           |
|----------------|------------------------------------------------|
| Reasoning      | Claude Opus 4.6 (extended thinking)            |
| Fast turn      | Claude Haiku 4.5                               |
| ASR            | Deepgram Nova-3 (streaming)                    |
| TTS            | ElevenLabs Turbo v2.5                          |
| VAD            | Silero (via @ricky0123/vad-web)                |
| Backend        | Node.js + TypeScript + Fastify + ws            |
| Frontend       | Electron + React + Vite + Three.js             |
| Memory         | SQLite + sqlite-vec (upgrade → Pinecone/Neo4j) |
| Policy         | Local rule engine (upgrade → OPA)              |

## Quick Start

```bash
# 1. Install dependencies (requires Node 20+ and pnpm)
pnpm install

# 2. Copy env template
cp .env.example .env
# Fill in: ANTHROPIC_API_KEY, DEEPGRAM_API_KEY, ELEVENLABS_API_KEY

# 3. Run orchestrator
pnpm --filter orchestrator dev

# 4. In another shell, run the HUD
pnpm --filter desktop dev
```

## Repository Layout

```
aria/
├── apps/desktop/          # Electron + React HUD
├── services/orchestrator/ # Node.js voice loop + brain
├── configs/               # Runtime configuration
├── prompts/               # System prompts & personality
├── docs/                  # Personality bible, voice spec, roadmap
└── tools/mcp/             # MCP tool registry
```

## Roadmap

- **Phase 1 (this repo):** Voice loop + reasoning + basic memory.
- **Phase 2:** Pinecone + Neo4j memory, emotion engine, proactive worker.
- **Phase 3:** HTN planner, OPA policies, smart home, multi-device.
- **Phase 4:** Ambient computing, AR HUD, self-improvement loop.

See `docs/ROADMAP.md` for full detail.
