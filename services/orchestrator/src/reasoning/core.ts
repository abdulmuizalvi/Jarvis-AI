/**
 * Reasoning Core — provider-agnostic LLM brain.
 *
 * Supports two providers (selected via aria.yaml `models.provider`):
 *   - "groq"      → Llama 3.3 70B / 3.1 8B via Groq's OpenAI-compatible API
 *   - "anthropic" → Claude Opus 4.6 / Haiku 4.5 with extended thinking
 *
 * Both paths stream tokens sentence-by-sentence to TTS, persist turns,
 * and produce a confidence-scored ReasonResult for the autonomy gate.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";
import { REPO_ROOT, type AriaConfig } from "../config.js";
import type { MemoryBroker } from "../memory/broker.js";
import { styleFromAffect, type Affect } from "../emotion/fusion.js";
import { ARIA_TOOLS } from "../agent/tools.js";

export interface ReasonRequest {
  sessionId: string;
  userText: string;
  affect: Affect;
  convState?: "ambient" | "engaged";
  onToken: (text: string) => void;
  onToolUse?: (name: string, input: unknown) => Promise<unknown>;
}

export interface ReasonResult {
  text: string;
  confidence: number;
  thought: string;
}

export class ReasoningCore {
  private anthropic: Anthropic | null = null;
  private groq: OpenAI | null = null;
  private systemPrompt: string;
  private provider: "groq" | "anthropic";

  constructor(
    private config: AriaConfig,
    private memory: MemoryBroker,
    private log: Logger,
  ) {
    this.provider = config.aria.models.provider;
    const promptPath = join(REPO_ROOT, "prompts", "system_core.md");
    this.systemPrompt = readFileSync(promptPath, "utf-8");

    if (this.provider === "anthropic") {
      this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    } else {
      // Groq OpenAI-compatible endpoint. The Groq key may live in either
      // GROQ_API_KEY (preferred) or ANTHROPIC_API_KEY (legacy slot).
      const apiKey = process.env.GROQ_API_KEY ?? process.env.ANTHROPIC_API_KEY;
      this.groq = new OpenAI({
        apiKey,
        baseURL: config.aria.models.base_url_groq ?? "https://api.groq.com/openai/v1",
      });
    }

    this.log.info({ provider: this.provider, model: config.aria.models.reasoning_primary }, "reasoning core ready");
  }

  async reason(req: ReasonRequest): Promise<ReasonResult> {
    return this.provider === "groq" ? this.reasonGroq(req) : this.reasonAnthropic(req);
  }

  // ───────────────────────── GROQ PATH ─────────────────────────

  private async reasonGroq(req: ReasonRequest): Promise<ReasonResult> {
    if (!this.groq) throw new Error("groq client not initialized");

    const style = styleFromAffect(req.affect);
    const memories = this.memory.retrieve(req.userText, this.config.aria.memory.retrieval_top_k);
    const recent = this.memory.recentTurns(req.sessionId, this.config.aria.memory.working_window_turns);

    const memoryBlock = memories.length
      ? memories.map((m) => `- [${m.kind}] ${m.content}`).join("\n")
      : "(no prior memories)";

    const systemMessage =
      this.systemPrompt +
      `\n\n<memory>\n${memoryBlock}\n</memory>\n` +
      `<affect>${JSON.stringify(req.affect)}</affect>\n` +
      `<style>${JSON.stringify(style)}</style>\n` +
      `<conv_state>${req.convState ?? "engaged"}</conv_state>`;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemMessage },
      ...recent.map((t: any) => ({ role: t.role as "user" | "assistant", content: t.content as string })),
      { role: "user", content: req.userText },
    ];

    this.log.debug(
      { model: this.config.aria.models.reasoning_primary, msgs: messages.length },
      "calling Groq",
    );

    const stream = await this.groq.chat.completions.create({
      model: this.config.aria.models.reasoning_primary,
      messages,
      stream: true,
      max_tokens: 1024,
      temperature: 0.7,
    });

    const textParts: string[] = [];
    let sentenceBuffer = "";

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (!delta) continue;
      textParts.push(delta);
      sentenceBuffer += delta;
      // Flush full sentences to TTS as they complete.
      let match: RegExpMatchArray | null;
      while ((match = sentenceBuffer.match(/^(.*?[.!?])\s/))) {
        req.onToken(match[1] + " ");
        sentenceBuffer = sentenceBuffer.slice(match[0].length);
      }
    }
    if (sentenceBuffer.trim()) req.onToken(sentenceBuffer);

    const text = textParts.join("");
    const confidence = this.scoreConfidence("", `${memoryBlock}`);

    this.memory.recordTurn(req.sessionId, "user", req.userText, req.affect);
    this.memory.recordTurn(req.sessionId, "assistant", text, {});

    return { text, confidence, thought: "" };
  }

  // ─────────────────────── ANTHROPIC PATH ──────────────────────

  private async reasonAnthropic(req: ReasonRequest): Promise<ReasonResult> {
    if (!this.anthropic) throw new Error("anthropic client not initialized");

    const style = styleFromAffect(req.affect);
    const memories = this.memory.retrieve(req.userText, this.config.aria.memory.retrieval_top_k);
    const recent = this.memory.recentTurns(req.sessionId, this.config.aria.memory.working_window_turns);

    const memoryBlock = memories.length
      ? memories.map((m) => `- [${m.kind}] ${m.content}`).join("\n")
      : "(no prior memories)";

    const history = recent.map((t: any) => ({
      role: t.role as "user" | "assistant",
      content: t.content as string,
    }));

    const contextPreamble =
      `<memory>\n${memoryBlock}\n</memory>\n\n` +
      `<affect>${JSON.stringify(req.affect)}</affect>\n\n` +
      `<style>${JSON.stringify(style)}</style>\n\n`;

    const messages = [
      ...history,
      { role: "user" as const, content: contextPreamble + req.userText },
    ];

    const extendedThinking = this.config.aria.models.extended_thinking;
    const thinkingBudget = this.config.aria.models.thinking_budget_tokens ?? 4000;
    const maxTokens = Math.max(thinkingBudget + 2048, 4096);

    const streamParams: any = {
      model: this.config.aria.models.reasoning_primary,
      max_tokens: maxTokens,
      system: this.systemPrompt,
      messages,
      tools: ARIA_TOOLS,
    };
    if (extendedThinking) {
      streamParams.thinking = { type: "enabled", budget_tokens: thinkingBudget };
    }

    const thoughtParts: string[] = [];
    const textParts: string[] = [];
    let sentenceBuffer = "";

    const stream = this.anthropic.messages.stream(streamParams);

    stream.on("text", (delta) => {
      textParts.push(delta);
      sentenceBuffer += delta;
      let match: RegExpMatchArray | null;
      while ((match = sentenceBuffer.match(/^(.*?[.!?])\s/))) {
        req.onToken(match[1] + " ");
        sentenceBuffer = sentenceBuffer.slice(match[0].length);
      }
    });

    (stream as any).on("thinking", (delta: any) => {
  thoughtParts.push(delta);
});

    const final = await stream.finalMessage();
    if (sentenceBuffer.trim()) req.onToken(sentenceBuffer);

    for (const block of final.content) {
      if (block.type === "tool_use" && req.onToolUse) {
        this.log.info({ tool: block.name }, "executing tool");
        await req.onToolUse(block.name, block.input);
      }
    }

    const text = textParts.join("");
    const thought = thoughtParts.join("");
    const confidence = this.scoreConfidence(thought, memoryBlock);

    this.memory.recordTurn(req.sessionId, "user", req.userText, req.affect);
    this.memory.recordTurn(req.sessionId, "assistant", text, {});

    return { text, confidence, thought };
  }

  private scoreConfidence(thought: string, memoryBlock: string): number {
    let base = 0.6;
    if (/\b(certain|clear|confirmed|verified)\b/i.test(thought)) base += 0.15;
    if (/\b(unsure|maybe|might|possibly|uncertain)\b/i.test(thought)) base -= 0.2;
    if (memoryBlock.length > 500) base += 0.1;
    return Math.max(0, Math.min(1, base));
  }
}
