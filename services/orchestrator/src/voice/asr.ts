/**
 * Deepgram streaming ASR wrapper.
 *
 * Uses Deepgram's `UtteranceEnd` event to coalesce multiple `is_final`
 * fragments into a single complete utterance — this is the canonical way
 * to handle conversational turn-taking. Each interim/final transcript is
 * forwarded for live display, but the orchestrator only acts on the full
 * utterance once Deepgram signals the user has stopped speaking.
 */

import { createClient, LiveTranscriptionEvents, type LiveClient } from "@deepgram/sdk";

export interface ASROptions {
  apiKey: string;
  model: string;
  endpointingMs: number;
  utteranceEndMs: number;
  sampleRate?: number;
  onPartial: (text: string) => void;
  onFinalFragment: (text: string) => void;
  onUtteranceEnd: () => void;
}

export class DeepgramASR {
  private live: LiveClient | null = null;

  constructor(private opts: ASROptions) {}

  async connect() {
    if (!this.opts.apiKey) {
      console.warn("[ASR] DEEPGRAM_API_KEY missing — ASR will be inactive");
      return;
    }
    const dg = createClient(this.opts.apiKey);

    this.live = dg.listen.live({
      model: this.opts.model,
      language: "en",
      smart_format: true,
      interim_results: true,
      endpointing: this.opts.endpointingMs,
      utterance_end_ms: this.opts.utteranceEndMs,
      vad_events: true,
      encoding: "linear16",
      sample_rate: this.opts.sampleRate ?? 16000,
      channels: 1,
    });

    this.live.on(LiveTranscriptionEvents.Transcript, (data: any) => {
      const alt = data?.channel?.alternatives?.[0];
      if (!alt?.transcript) return;
      if (data.is_final) this.opts.onFinalFragment(alt.transcript);
      else this.opts.onPartial(alt.transcript);
    });

    this.live.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      this.opts.onUtteranceEnd();
    });

    this.live.on(LiveTranscriptionEvents.Error, (err: unknown) => {
      console.error("[ASR] error", err);
    });
  }

  sendAudio(buf: Buffer) {
    this.live?.send(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }

  close() {
    this.live?.requestClose();
    this.live = null;
  }
}
