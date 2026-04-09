/**
 * ElevenLabs streaming TTS wrapper.
 *
 * For each sentence-sized chunk of assistant text, calls the streaming
 * endpoint and forwards PCM audio chunks (base64) to the client.
 *
 * Phase 2: upgrade to ElevenLabs WebSocket multi-stream for sub-300ms
 * first-audio latency and seamless sentence chaining.
 */

import { fetch } from "undici";

export interface TTSOptions {
  apiKey: string;
  voiceId: string;
  model: string;
  onAudio: (base64Chunk: string) => void;
}

export class ElevenLabsTTS {
  private controller: AbortController | null = null;

  constructor(private opts: TTSOptions) {}

  async speak(text: string) {
    if (!this.opts.apiKey || !text.trim()) return;
    this.controller = new AbortController();

    const url =
      `https://api.elevenlabs.io/v1/text-to-speech/${this.opts.voiceId}/stream` +
      `?optimize_streaming_latency=3&output_format=pcm_24000`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": this.opts.apiKey,
        "content-type": "application/json",
        "accept": "audio/pcm",
      },
      body: JSON.stringify({
        text,
        model_id: this.opts.model,
        voice_settings: {
          stability: 0.55,
          similarity_boost: 0.85,
          style: 0.25,
          use_speaker_boost: true,
        },
      }),
      signal: this.controller.signal,
    });

    if (!res.ok || !res.body) {
      console.error("[TTS] error", res.status, await res.text().catch(() => ""));
      return;
    }

    const reader = (res.body as any).getReader
      ? (res.body as any).getReader()
      : null;

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.opts.onAudio(Buffer.from(value).toString("base64"));
      }
    } else {
      // Node stream fallback
      for await (const chunk of res.body as any) {
        this.opts.onAudio(Buffer.from(chunk).toString("base64"));
      }
    }
  }

  cancel() {
    this.controller?.abort();
    this.controller = null;
  }
}
