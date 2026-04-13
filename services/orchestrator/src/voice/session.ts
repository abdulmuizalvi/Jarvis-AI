/**
 * VoiceSession — full-duplex voice conversation with JARVIS.
 *
 * ─── Conversation State Machine (wake-word-free) ───────────────────────────
 *
 *   AMBIENT ──(LLM intent = address_jarvis)──▶ ENGAGED ──(triggers)──▶ AMBIENT
 *
 *   AMBIENT:
 *     - Always buffers and saves every utterance to memory.
 *     - Every utterance runs through an LLM intent classifier.
 *     - If the classifier decides the user is addressing JARVIS, JARVIS
 *       responds and the conversation engages.
 *     - The wake word "jarvis" is still a fast-path (skips the classifier),
 *       but is no longer required.
 *
 *   ENGAGED:
 *     - Active conversation. JARVIS responds to everything the user says.
 *     - Returns to AMBIENT when:
 *         1. engagement_timeout_ms of silence (default 120s)
 *         2. User says a disengagement phrase ("goodbye", "that's all")
 *         3. TWO consecutive utterances are detected as directed elsewhere
 *            (hysteresis — single false positives don't drop the conversation)
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

/** Minimum utterance length (chars) to bother classifying. Below this, ignore. */
const MIN_CLASSIFY_LEN = 4;

type ConvState = "ambient" | "engaged";

export class VoiceSession {
  private asr: DeepgramASR;
  private tts: ElevenLabsTTS | null = null;
  private ttsMode: "browser" | "elevenlabs";
  private active = false;
  private speaking = false;

  /** User location context sent by the browser. */
  private userContext: { timezone?: string; lat?: number; lng?: number; city?: string } = {};

  /** ASR fragment buffer for the current utterance. */
  private utteranceBuffer: string[] = [];

  /** Current conversation engagement state. */
  private convState: ConvState = "ambient";

  /** Timer handle for engagement timeout. */
  private engagementTimer: ReturnType<typeof setTimeout> | null = null;

  /** Hysteresis counter — consecutive utterances detected as third-party. */
  private thirdPartyStreak = 0;

  /** Wake-word regex (still a fast-path even though no longer required). */
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
      language: deps.config.aria.voice.asr.language ?? "multi",
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
        if (msg.type === "start") {
          // User explicitly clicked "engage" — enter engaged mode immediately
          // so JARVIS responds to everything without requiring wake word or
          // passing the ambient classifier.
          if (this.convState === "ambient") this.engage();
        } else if (msg.type === "context") {
          // Browser sends timezone and optional geolocation.
          if (msg.timezone) this.userContext.timezone = msg.timezone;
          if (msg.lat != null) this.userContext.lat = msg.lat;
          if (msg.lng != null) this.userContext.lng = msg.lng;
          if (msg.city) this.userContext.city = msg.city;
          this.deps.logger.info({ ctx: this.userContext }, "user context updated");
        } else if (msg.type === "text") {
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

  // ─────────────────── ambient mode (no wake word required) ──────────

  private async handleAmbient(utterance: string) {
    // Fast path: explicit wake word — engage instantly, skip classifier.
    if (this.wakeWordRe.test(utterance)) {
      const cleaned = utterance.replace(this.wakeWordRe, "").replace(/^[\s,.!?]+/, "").trim();
      const message = cleaned.length >= 2 ? cleaned : utterance;
      this.engage();
      await this.respondTo(message, { source: "voice", wakeWordHeard: true });
      return;
    }

    // Too short — almost always background noise, never engage on these.
    if (utterance.length < MIN_CLASSIFY_LEN) {
      this.send({ type: "ambient_logged", text: utterance });
      return;
    }

    // Smart engagement detection — let the LLM decide if the user is
    // addressing JARVIS or someone/something else.
    const intent = await this.classifyIntent(utterance, "ambient");

    if (intent === "address_jarvis") {
      this.deps.logger.info({ utterance }, "ambient — LLM detected user addressing JARVIS, engaging");
      this.engage();
      await this.respondTo(utterance, { source: "voice" });
    } else {
      this.send({ type: "ambient_logged", text: utterance });
      this.deps.logger.info({ utterance }, "ambient — not addressed to JARVIS");
    }
  }

  // ─────────────────── engaged mode ───────────────────

  private async handleEngaged(utterance: string) {
    // 1. Wake word always responds immediately.
    if (this.wakeWordRe.test(utterance)) {
      const cleaned = utterance.replace(this.wakeWordRe, "").replace(/^[\s,.!?]+/, "").trim();
      this.resetEngagementTimer();
      await this.respondTo(cleaned.length >= 2 ? cleaned : utterance, { source: "voice" });
      return;
    }

    // 2. Smart audience detection — only skip utterances that are CLEARLY
    //    part of a conversation with another human. Default: respond.
    const intent = await this.classifyIntent(utterance, "engaged");

    if (intent !== "address_jarvis") {
      // Just skip this one utterance silently — do NOT disengage.
      // JARVIS stays engaged and ready for the next thing directed at it.
      this.send({ type: "ambient_logged", text: utterance });
      this.deps.logger.info({ utterance }, "engaged — skipping (talking to someone else)");
      this.resetEngagementTimer();
      return;
    }

    // 3. Directed at JARVIS — respond.
    this.resetEngagementTimer();
    await this.respondTo(utterance, { source: "voice" });
  }

  // ─────────────────── intent classifier ───────────────────

  /**
   * Determines whether an utterance is being directed at JARVIS.
   *
   * Returns "address_jarvis" or "ignore".
   *
   * Two-layer check:
   *   1. Fast regex — wake word always engages, "Hey [OtherName]," never does.
   *   2. LLM classifier — llama-3.1-8b-instant via Groq (~200ms). Uses
   *      different bias depending on whether we are already engaged.
   *
   * Engaged-mode bias is more lenient (defaults to address_jarvis on doubt)
   * because the user is mid-conversation. Ambient bias is stricter (defaults
   * to ignore on doubt) so JARVIS doesn't randomly interject.
   */
  private async classifyIntent(
    utterance: string,
    mode: "ambient" | "engaged",
  ): Promise<"address_jarvis" | "ignore"> {
    // Fast path: wake word always wins.
    if (this.wakeWordRe.test(utterance)) return "address_jarvis";

    // Fast path: "Hey [OtherName]," at the start → never directed at JARVIS.
    const thirdPartyMatch = utterance.match(THIRD_PARTY_RE);
    if (thirdPartyMatch) {
      const name = thirdPartyMatch[1].toLowerCase();
      const wakeAliases = this.deps.config.aria.runtime.wake_word_aliases ?? ["jarvis"];
      if (!wakeAliases.includes(name)) return "ignore";
    }

    if (!this.classifier) {
      return mode === "engaged" ? "address_jarvis" : "ignore";
    }

    // Build recent conversation context so the classifier can see the flow.
    const recent = this.deps.memory.recentTurns(this.deps.id, 4);
    const contextLines = recent.map((t: any) =>
      `${t.role === "user" ? "User" : "JARVIS"}: ${(t.content as string).slice(0, 120)}`
    ).join("\n");

    const systemPrompt =
      mode === "engaged"
        ? `You decide if a voice utterance is CLEARLY directed at JARVIS (AI assistant) or NOT.

RECENT CONVERSATION:
${contextLines || "(none)"}

Reply EXACTLY "yes" or "no".

"yes" ONLY when:
- User says "Jarvis" or addresses the assistant by name
- A direct follow-up question that ONLY makes sense as a reply to what JARVIS just said above
- An explicit command for an AI ("search for", "remind me", "explain", "translate", "what is")
- A clear information question ("what time is it", "how far is", "who was")

"no" for EVERYTHING else:
- Casual speech, opinions, thinking out loud ("hmm", "yeah", "ok so", "I think")
- Talking to another person ("pass me that", "you coming?", "bro", "hey", "mom")
- Statements not asking JARVIS anything ("that's cool", "I need to go", "she said")
- Fragments, fillers, laughter, background noise
- Anything where you're not 100% sure it's for JARVIS

CRITICAL: When uncertain, answer "no". JARVIS must NOT interrupt. Only say "yes" when you are CERTAIN the user is speaking TO the assistant.`
        : `You classify if a voice utterance is directed at JARVIS (AI assistant) or is background speech.

Reply EXACTLY "yes" or "no".

"yes" = addressing an assistant: questions, commands, naming JARVIS, asking for information. Any language counts.
"no"  = talking to another human, on a phone, narrating to themselves, background noise, fragments.

When uncertain, answer "no". Examples:
"jarvis what time is it" → yes | "what's the weather" → yes | "set a timer" → yes
"hey michael grab the keys" → no | "she said three o'clock" → no | "ummm yeah" → no`;

    try {
      const res = await this.classifier.chat.completions.create({
        model: this.deps.config.aria.models.classifier ?? "llama-3.1-8b-instant",
        max_tokens: 3,
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: utterance },
        ],
      });

      const verdict = res.choices[0]?.message?.content?.trim().toLowerCase() ?? "no";
      const addressed = verdict.startsWith("y");
      this.deps.logger.debug({ utterance, mode, verdict, context: contextLines }, "intent classification");
      return addressed ? "address_jarvis" : "ignore";
    } catch (err) {
      return mode === "engaged" ? "address_jarvis" : "ignore";
    }
  }

  // ─────────────────── engagement timer ───────────────────

  private engage() {
    this.convState = "engaged";
    this.thirdPartyStreak = 0;
    this.send({ type: "conv_state", conv: "engaged" });
    this.deps.logger.info("conversation engaged");
    this.resetEngagementTimer();
  }

  private disengage() {
    this.convState = "ambient";
    this.thirdPartyStreak = 0;
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
        userContext: this.userContext,
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
