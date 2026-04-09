import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Repo root is three levels up from src/
export const REPO_ROOT = join(__dirname, "..", "..", "..");

export interface AriaConfig {
  aria: {
    identity: { name: string; version: string; persona: string; pronouns: string };
    runtime: {
      mode: "push_to_talk" | "wake_word" | "ambient";
      wake_word: string;
      wake_word_aliases: string[];
      max_context_tokens: number;
      dual_track_reasoning: boolean;
      first_audio_budget_ms: number;
      utterance_end_ms: number;
      engagement_timeout_ms: number;
    };
    models: {
      provider: "groq" | "anthropic";
      reasoning_primary: string;
      reasoning_fast: string;
      classifier: string;
      extended_thinking: boolean;
      thinking_budget_tokens: number;
      fallback_local: string;
      base_url_groq?: string;
    };
    voice: {
      asr: { provider: string; model: string; streaming: boolean; interim_results: boolean; endpointing_ms: number; diarize: boolean };
      tts: { provider: "browser" | "elevenlabs"; voice_id: string; model: string; optimize_latency: number; stability: number; similarity_boost: number; style: number };
      vad: { provider: string; threshold: number };
      barge_in: boolean;
    };
    memory: { driver: string; working_window_turns: number; consolidation_cron: string; decay_tau_days: number; retrieval_top_k: number };
    autonomy: { default_tier: number; confidence_gate: { act: number; ask: number }; require_confirm_tiers: number[]; require_biometric_tiers: number[] };
    emotion: { enabled: boolean; fusion: string[]; smoothing_alpha: number };
    safety: { policy_engine: string; audit_log: boolean; pii_redaction: boolean; blocked_actions: string[] };
  };
}

export function loadConfig(path?: string): AriaConfig {
  const p = path ?? join(REPO_ROOT, "configs", "aria.yaml");
  const raw = readFileSync(p, "utf-8");
  return YAML.parse(raw) as AriaConfig;
}
