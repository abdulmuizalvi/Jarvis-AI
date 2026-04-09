/**
 * VoiceSession — full-duplex voice conversation with JARVIS.
 *
 * ─── Conversation State Machine ────────────────────────────────────────────
 *
 *   AMBIENT ──(wake word heard)──▶ ENGAGED ──(disengage trigger)──▶ AMBIENT
 *
 *   AMBIENT:
 *     - Always buffers and saves every utterance to memory.
 *     - JARVIS only speaks if the wake word "jarvis" is detected.
 *     - Silently logs everything else as ambient context.
 *
 *   ENGAGED:
 *     - Active conversation. JARVIS responds to everything the user says
 *       without needing the wake word again.
 *     - Returns to AMBIENT when:
 *         1. engagement_timeout_ms of silence (no user speech received)
 *         2. User says a disengagement phrase ("that's all", "goodbye", etc.)
 *         3. Audience detector classifies utterance as directed at someone
 *            else — JARVIS goes quiet and logs it as ambient.
 *
 *   TEXT input: always responds regardless of state (explicit intent).
 *
 * ─── Wire Protocol ─────────────────────────────────────────────────────────
 *   Client → Server:
 *     { type: "start" }
 *     { type: "text", text }          ← typed input, always responds
 *     <binary PCM16 @ 16kHz>
 *     { type: "stop" }
 *
 *   Server → Client:
 *     { type: "state", state }        ← "listening"|"thinking"|"speaking"|"idle"
 *     { type: "conv_state", conv }    ← "ambient"|"engaged"
 *     { type: "partial_transcript", text }
 *     { type: "final_transcript", text }
 *     { type: "ambient_logged", text }
 *     { type: "affect", affect }
 *     { type: "speech_chunk", text }
 *     { type: "audio_chunk", b64 }
 *     { type: "tts_cancel" }
 *     { type: "done" }
 *     { type: "error", message }
 */

import type { WebSocket } from "ws";
import type { Logger } from "pino";
import type { AriaConfig } from "../config.js";
import type { MemoryBroker } from "../memory/broker.js";
import type { ReasoningCore } from "../reasoning/core.js";
import { DeepgramASR } from "./asr.js";
import { ElevenLabsTTS } from "./tts.js";
import { analyzeText } from "../emotion/fusion.js";
import OpenAI from "openai";

interface SessionDeps {
  id: string;
  ws: WebSocket;
  config: AriaConfig;
  memory: MemoryBroker;
  reasoner: ReasoningCore;
  logger: Logger;
}

/** Phrases that explicitly end the conversation with JARVIS. */
const DISENGAGE_RE =
  /\b(that('?s| is) (all|it)|thank you(,? jarvis)?|goodbye(,? jarvis)?|bye(,? jarvis)?|never mind|dismiss|stand down|i('m| am) good|we('re| are) done|you can go)\b/i;

/** Patterns that strongly suggest the user is addressing someone else. */
const THIRD_PARTY_RE =
  /^(?:hey |hi |okay |ok |excuse me )?([A-Z][a-z]{1,14})\s*[,!]/;

type ConvState = "ambient" | "engaged";

export class VoiceSession {
  private asr: DeepgramASR;
  private tts: ElevenLabsTTS | null = null;
  private ttsMode: "browser" | "elevenlabs";
  private active = false;
  private speaking = false;

  /** ASR fragment buffer for the current utterance. */
  private utteranceBuffer: string[] = [];

  /** Current conversation engagement state. */
  private convState: ConvState = "ambient";

  /** Timer handle for engagement timeout. */
  private engagementTimer: ReturnType<typeof setTimeout> | null = null;

  /** Wake-word regex (includes aliases). */
  private wakeWordRe: RegExp;

  /** Lightweight Groq client for audience classification. */
  private classifier: OpenAI | null = null;

  constructor(private deps: SessionDeps) {
    const aliases = deps.config.aria.runtime.wake_word_aliases?.length
      ? deps.config.aria.runtime.wake_word_aliases
      : [deps.config.aria.runtime.wake_word];
    this.wakeWordRe = new RegExp(`\\b(?:${aliases.join("|")})\\b`, "i");

    this.asr = new DeepgramASR({
      apiKey: process.env.DEEPGRAM_API_KEY ?? "",
      model: deps.config.aria.voice.asr.model,
      endpointingMs: deps.config.aria.voice.asr.endpointing_ms,
      utteranceEndMs: deps.config.aria.runtime.utterance_end_ms ?? 1500,
      onPartial: (t) => this.send({ type: "partial_transcript", text: t }),
      onFinalFragment: (t) => this.bufferFragment(t),
      onUtteranceEnd: () => this.commitUtterance(),
    });

    this.ttsMode = deps.config.aria.voice.tts.provider;
    if (this.ttsMode === "elevenlabs") {
      this.tts = new ElevenLabsTTS({
        apiKey: process.env.ELEVENLABS_API_KEY ?? "",
        voiceId: process.env.ELEVENLABS_VOICE_ID ?? deps.config.aria.voice.tts.voice_id,
        model: deps.config.aria.voice.tts.model,
        onAudio: (b64) => this.send({ type: "audio_chunk", b64 }),
      });
    }

    // Classifier shares the same Groq endpoint as the reasoner.
    if (deps.config.aria.models.provider === "groq") {
      const apiKey = process.env.GROQ_API_KEY ?? process.env.ANTHROPIC_API_KEY;
      this.classifier = new OpenAI({
        apiKey,
        baseURL: deps.config.aria.models.base_url_groq ?? "https://api.groq.com/openai/v1",
      });
    }
  }

  // ─────────────────── lifecycle ───────────────────

  async start() {
    this.active = true;
    this.send({ type: "state", state: "listening" });
    this.send({ type: "conv_state", conv: "ambient" });
    await this.asr.connect();

    this.deps.ws.on("message", async (data, isBinary) => {
      if (!this.active) return;

      if (isBinary) {
        this.asr.sendAudio(data as Buffer);
        if (this.speaking && this.deps.config.aria.voice.barge_in) {
          this.tts?.cancel();
          this.send({ type: "tts_cancel" });
          this.speaking = false;
          this.send({ type: "state", state: "listening" });
        }
        return;
      }

      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "text") {
          await this.respondTo(msg.text, { source: "text" });
        } else if (msg.type === "utterance_test") {
          // Test-only: simulate a committed voice utterance without real ASR.
          this.bufferFragment(msg.text);
          await this.commitUtterance();
        } else if (msg.type === "stop") {
          this.stop();
        }
      } catch (err) {
        this.deps.logger.warn({ err }, "invalid client message");
      }
    });
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.clearEngagementTimer();
    this.asr.close();
    this.tts?.cancel();
  }

  // ─────────────────── ASR buffering ───────────────────

  private bufferFragment(fragment: string) {
    const t = fragment.trim();
    if (!t || t.length < 3) return;
    this.utteranceBuffer.push(t);
  }

  private async commitUtterance() {
    if (this.utteranceBuffer.length === 0) return;

    // Small grace period so a final fragment fired just before UtteranceEnd
    // isn't lost mid-join.
    await new Promise((r) => setTimeout(r, 400));

    const utterance = this.utteranceBuffer.join(" ").replace(/\s+/g, " ").trim();
    this.utteranceBuffer = [];
    if (!utterance) return;

    this.send({ type: "final_transcript", text: utterance });
    this.deps.logger.info({ utterance, convState: this.convState }, "utterance committed");

    // ── Always save to memory ───────────────────────────────────────────
    this.deps.memory.remember("episodic", utterance, { tags: ["ambient", "voice"], salience: 0.3 });
    this.deps.memory.recordTurn(this.deps.id, "user", utterance, { source: "voice" });

    // ── Route based on conversation state ──────────────────────────────
    if (this.convState === "ambient") {
      await this.handleAmbient(utterance);
    } else {
      await this.handleEngaged(utterance);
    }
  }

  // ─────────────────── ambient mode ───────────────────

  private async handleAmbient(utterance: string) {
    const hasWake = this.wakeWordRe.test(utterance);
    if (!hasWake) {
      this.send({ type: "ambient_logged", text: utterance });
      this.deps.logger.info({ utterance }, "ambient — no wake word");
      return;
    }

    // Strip the wake word so JARVIS doesn't waste tokens on it.
    const cleaned = utterance.replace(this.wakeWordRe, "").replace(/^[\s,.!?]+/, "").trim();
    const message = cleaned.length >= 2 ? cleaned : utterance;

    this.engage();
    await this.respondTo(message, { source: "voice", wakeWordHeard: true });
  }

  // ─────────────────── engaged mode ───────────────────

  private async handleEngaged(utterance: string) {
    // 1. Explicit disengagement phrase.
    if (DISENGAGE_RE.test(utterance)) {
      this.deps.logger.info({ utterance }, "disengagement phrase — going ambient");
      this.disengage();
      return;
    }

    // 2. Audience detection — is the user talking to someone else?
    const directedElsewhere = await this.isDirectedElsewhere(utterance);
    if (directedElsewhere) {
      this.send({ type: "ambient_logged", text: utterance });
      this.deps.logger.info({ utterance }, "engaged — detected talking to someone else, going ambient");
      this.disengage();
      return;
    }

    // 3. Active conversation — reset timer and respond.
    this.resetEngagementTimer();
    await this.respondTo(utterance, { source: "voice" });
  }

  // ─────────────────── audience detection ───────────────────

  /**
   * Determines whether the utterance is directed at someone other than JARVIS.
   *
   * Two-layer check:
   *   1. Fast regex — catches obvious "Hey [Name]," patterns (< 1ms).
   *   2. LLM classifier — llama-3.1-8b-instant via Groq (~200ms).
   *      Only called when the regex doesn't give a clear answer.
   */
  private async isDirectedElsewhere(utterance: string): Promise<boolean> {
    // Fast path: explicitly addressing JARVIS.
    if (this.wakeWordRe.test(utterance)) return false;

    // Fast path: "Hey [OtherName]," at the start.
    const thirdPartyMatch = utterance.match(THIRD_PARTY_RE);
    if (thirdPartyMatch) {
      const name = thirdPartyMatch[1].toLowerCase();
      const wakeAliases = this.deps.config.aria.runtime.wake_word_aliases ?? ["jarvis"];
      if (!wakeAliases.includes(name)) return true;
    }

    // LLM classifier for ambiguous cases.
    if (!this.classifier) return false;

    try {
      const res = await this.classifier.chat.completions.create({
        model: this.deps.config.aria.models.classifier ?? "llama-3.1-8b-instant",
        max_tokens: 5,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You are a classifier. Answer ONLY with 'self' or 'other'.\n" +
              "'self' = this utterance is directed at the AI assistant (JARVIS).\n" +
              "'other' = the speaker is talking to another person in the room, on the phone, or to themselves.\n" +
              "When in doubt, say 'self'.",
          },
          { role: "user", content: `Utterance: "${utterance}"` },
        ],
      });

      const verdict = res.choices[0]?.message?.content?.trim().toLowerCase() ?? "self";
      this.deps.logger.debug({ utterance, verdict }, "audience classification");
      return verdict === "other";
    } catch (err) {
      // On classifier failure, assume engaged — safer than ignoring the user.
      return false;
    }
  }

  // ─────────────────── engagement timer ───────────────────

  private engage() {
    this.convState = "engaged";
    this.send({ type: "conv_state", conv: "engaged" });
    this.deps.logger.info("conversation engaged");
    this.resetEngagementTimer();
  }

  private disengage() {
    this.convState = "ambient";
    this.clearEngagementTimer();
    this.send({ type: "conv_state", conv: "ambient" });
    this.deps.logger.info("conversation disengaged — back to ambient");
  }

  private resetEngagementTimer() {
    this.clearEngagementTimer();
    const timeoutMs = this.deps.config.aria.runtime.engagement_timeout_ms ?? 30000;
    this.engagementTimer = setTimeout(() => {
      this.deps.logger.info({ timeoutMs }, "engagement timeout — going ambient");
      this.disengage();
    }, timeoutMs);
  }

  private clearEngagementTimer() {
    if (this.engagementTimer) {
      clearTimeout(this.engagementTimer);
      this.engagementTimer = null;
    }
  }

  // ─────────────────── reasoning + speaking ───────────────────

  private async respondTo(
    text: string,
    meta: { source: "voice" | "text"; wakeWordHeard?: boolean },
  ) {
    if (!text.trim()) return;
    this.deps.logger.info({ text, ...meta, convState: this.convState }, "responding");

    if (meta.source === "text") {
      this.send({ type: "final_transcript", text });
      // Text input also engages the conversation.
      if (this.convState === "ambient") this.engage();
      else this.resetEngagementTimer();
    }

    const affect = analyzeText(text);
    this.send({ type: "affect", affect });
    this.send({ type: "state", state: "thinking" });

    try {
      this.speaking = true;
      this.send({ type: "state", state: "speaking" });

      const result = await this.deps.reasoner.reason({
        sessionId: this.deps.id,
        userText: text,
        affect,
        convState: this.convState,
        onToken: (chunk) => {
          this.send({ type: "speech_chunk", text: chunk });
          if (this.ttsMode === "elevenlabs" && this.tts) {
            this.tts.speak(chunk).catch((err) =>
              this.deps.logger.error({ err }, "tts chunk failed"),
            );
          }
        },
      });

      this.deps.logger.info({ confidence: result.confidence, len: result.text.length }, "assistant done");

      // Keep the conversation alive after each JARVIS response.
      if (this.convState === "engaged") this.resetEngagementTimer();

    } catch (err: any) {
      this.deps.logger.error({ err: err?.message, status: err?.status }, "reasoning failed");
      this.send({ type: "error", message: err?.message ?? "reasoning failed" });
    } finally {
      this.speaking = false;
      this.send({ type: "state", state: "listening" });
      this.send({ type: "done" });
    }
  }

  private send(obj: object) {
    if (this.deps.ws.readyState === 1) {
      this.deps.ws.send(JSON.stringify(obj));
    }
  }
}
