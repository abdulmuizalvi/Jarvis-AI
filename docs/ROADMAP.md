# ARIA Build Roadmap

## Phase 1 — MVP: "ARIA Speaks" (this repo)

**Goal:** End-to-end voice loop + Claude reasoning + basic persistent memory.

**Features**
- Full-duplex WebSocket voice pipeline (Deepgram → Claude → ElevenLabs)
- Push-to-talk and continuous-listen modes
- SQLite-backed working + episodic memory
- 5 core tools: calendar read, weather, web search, notes, timer
- Electron HUD with waveform visualizer
- System prompt + ARIA-Prime personality

**Team:** 1–2 engineers
**Key risks:** first-audio latency, TTS naturalness, interruption jitter

---

## Phase 2 — "ARIA Remembers"

**Goal:** Real memory + emotion + proactive cognition.

**Features**
- Pinecone (vector) + Neo4j (graph) memory
- Nightly memory consolidation worker
- Audio+text emotion fusion
- Goal stack + proactive suggester
- 20+ MCP tools (email, Slack, GitHub, Home Assistant, Files, Browser)
- iOS client + watchOS complications

**Team:** 4–6 (full-stack, ML, iOS, designer)
**Key risks:** memory drift, proactive false positives, privacy surface area

---

## Phase 3 — "ARIA Acts"

**Goal:** Full agentic action with tiered autonomy.

**Features**
- HTN planner + ReAct loops
- OPA policy engine, tiered approvals, biometric gates
- Continuous perception (camera presence, gaze, directed speech)
- Smart home, vehicle, office control
- Multi-user household mode
- Self-hosted Llama 3.3 70B fallback for private mode

**Team:** 8–12 (+ security, robotics, ML ops)
**Key risks:** safety incidents, regulatory compliance, action reliability on long-horizon tasks

---

## Phase 4 — "ARIA Everywhere" (Near-JARVIS)

**Goal:** Ambient intelligence across devices and physical space.

**Features**
- AR HUD (Vision Pro + smart glasses)
- On-device reasoning for private mode
- Self-improving via RLHF from interaction feedback
- Multi-agent delegation (ARIA can spawn sub-agents)
- Optional robotic embodiment (table-top or mobile)

**Team:** 20+ (full product org)
**Key risks:** alignment, cost at scale, regulatory, long-horizon reliability
