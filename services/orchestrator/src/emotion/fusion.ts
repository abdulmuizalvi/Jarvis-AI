/**
 * Emotion fusion + style mapping.
 *
 * Phase 1: text-only sentiment (lightweight heuristic).
 * Phase 2: fuse with Deepgram prosody metadata + Hume audio affect.
 */

export interface Affect {
  valence: number;   // −1..1
  arousal: number;   // 0..1
  stress: number;    // 0..1
  urgency: number;   // 0..1
  mode: AffectMode;
}

export type AffectMode =
  | "calm" | "focused" | "stressed" | "excited"
  | "frustrated" | "melancholy" | "urgent" | "playful";

export interface StyleProfile {
  tone: string;
  pace_wpm: number;
  verbosity: "minimal" | "normal" | "rich";
  warmth: number;       // 0..1
  formality: number;    // 0..1
  humor: number;        // 0..1
  ssml_rate: string;
  ssml_pitch: string;
}

const URGENT_RE = /\b(urgent|now|asap|immediately|emergency|right now|hurry)\b/i;
const STRESS_RE = /\b(stressed|overwhelmed|panicking|frustrated|angry|annoyed|hate)\b/i;
const SAD_RE    = /\b(sad|tired|exhausted|lonely|miss|lost|hurt)\b/i;
const EXCITED_RE = /\b(amazing|incredible|love it|awesome|fantastic|yes+!)\b/i;

export function analyzeText(text: string): Affect {
  const t = text.toLowerCase();
  let valence = 0, arousal = 0.3, stress = 0, urgency = 0;

  if (URGENT_RE.test(t))  { urgency = 0.9; arousal = 0.8; }
  if (STRESS_RE.test(t))  { stress = 0.8; valence = -0.5; arousal = 0.7; }
  if (SAD_RE.test(t))     { valence = -0.6; arousal = 0.2; }
  if (EXCITED_RE.test(t)) { valence = 0.7; arousal = 0.8; }

  // Punctuation signal
  const excl = (text.match(/!/g) ?? []).length;
  if (excl >= 2) arousal = Math.min(1, arousal + 0.2);
  if (text === text.toUpperCase() && text.length > 5) arousal = Math.min(1, arousal + 0.2);

  return { valence, arousal, stress, urgency, mode: classify(valence, arousal, stress, urgency) };
}

function classify(v: number, a: number, s: number, u: number): AffectMode {
  if (u > 0.7) return "urgent";
  if (s > 0.6 && v < 0) return "stressed";
  if (v > 0.5 && a > 0.6) return "excited";
  if (v < -0.3 && a < 0.4) return "melancholy";
  if (a < 0.3) return "calm";
  return "focused";
}

export function styleFromAffect(a: Affect): StyleProfile {
  const presets: Record<AffectMode, StyleProfile> = {
    urgent:     { tone: "decisive",  pace_wpm: 175, verbosity: "minimal", warmth: 0.4, formality: 0.8, humor: 0.0, ssml_rate: "115%", ssml_pitch: "+2%" },
    stressed:   { tone: "grounding", pace_wpm: 135, verbosity: "minimal", warmth: 0.9, formality: 0.6, humor: 0.0, ssml_rate: "90%",  ssml_pitch: "-5%" },
    calm:       { tone: "composed",  pace_wpm: 150, verbosity: "normal",  warmth: 0.7, formality: 0.7, humor: 0.2, ssml_rate: "100%", ssml_pitch: "-3%" },
    focused:    { tone: "crisp",     pace_wpm: 155, verbosity: "minimal", warmth: 0.6, formality: 0.7, humor: 0.1, ssml_rate: "105%", ssml_pitch: "-3%" },
    excited:    { tone: "matching",  pace_wpm: 165, verbosity: "normal",  warmth: 0.8, formality: 0.5, humor: 0.3, ssml_rate: "110%", ssml_pitch: "0%"  },
    frustrated: { tone: "solving",   pace_wpm: 145, verbosity: "minimal", warmth: 0.7, formality: 0.6, humor: 0.0, ssml_rate: "95%",  ssml_pitch: "-4%" },
    melancholy: { tone: "warm",      pace_wpm: 130, verbosity: "minimal", warmth: 0.95,formality: 0.6, humor: 0.0, ssml_rate: "92%",  ssml_pitch: "-4%" },
    playful:    { tone: "dry",       pace_wpm: 155, verbosity: "normal",  warmth: 0.7, formality: 0.5, humor: 0.6, ssml_rate: "105%", ssml_pitch: "-2%" },
  };
  return presets[a.mode];
}
