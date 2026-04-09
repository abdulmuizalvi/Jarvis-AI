# ARIA Setup Guide

## Prerequisites

- Node.js 20+
- pnpm 9+ (`npm i -g pnpm`)
- API keys: Anthropic, Deepgram, ElevenLabs

## Install

```bash
cd ~/Desktop/ARIA
pnpm install
cp .env.example .env
# Edit .env and fill in:
#   ANTHROPIC_API_KEY
#   DEEPGRAM_API_KEY
#   ELEVENLABS_API_KEY
#   ELEVENLABS_VOICE_ID (your cloned ARIA-Prime voice id)
```

## Run (two shells)

**Shell 1 — Orchestrator (backend brain + voice pipeline):**
```bash
pnpm --filter orchestrator dev
```
Listens on `ws://127.0.0.1:8787/voice`.

**Shell 2 — HUD (Electron + React ambient interface):**
```bash
pnpm --filter desktop dev
```
Opens the ARIA orb window.

## First Conversation

1. Click **Engage** (or type in the text box to test without audio).
2. Speak naturally. The orb turns cyan when listening, violet when thinking, teal when speaking.
3. Press **Standby** to close the session.

## Voice Cloning (for ARIA-Prime)

1. Record 60 minutes of directed audio following `docs/VOICE_PERSONA_SPEC.md`.
2. Upload to ElevenLabs → Instant Voice Clone or Professional Voice Clone.
3. Copy the generated voice ID into `.env` as `ELEVENLABS_VOICE_ID`.
4. Restart orchestrator.

## Troubleshooting

| Symptom                        | Fix                                                        |
|--------------------------------|------------------------------------------------------------|
| Orb doesn't render             | Ensure GPU acceleration is enabled in Electron             |
| No audio coming back           | Check ELEVENLABS_API_KEY and voice_id in `.env`            |
| ASR silent                     | Check DEEPGRAM_API_KEY; ensure mic permission granted      |
| "Cannot find module" errors    | Run `pnpm install` at the repo root                        |
| High latency                   | Lower `endpointing_ms` in `configs/aria.yaml` to 150       |

## Next Steps

See `docs/ROADMAP.md` for Phase 2 (real memory, emotion fusion, MCP tools).
