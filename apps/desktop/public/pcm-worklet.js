/**
 * pcm-worklet — downsamples mic audio to 16kHz PCM16 in an AudioWorklet.
 *
 * This replaces the deprecated ScriptProcessorNode which does not work
 * reliably on iOS Safari or on modern Chrome (main-thread jank, sample-rate
 * mismatch). The AudioWorklet runs on a dedicated audio thread, takes
 * whatever sample rate the device gives us (typically 48000 on iOS/Android,
 * 44100 on desktop), and streams clean 16kHz PCM16 frames back to the main
 * thread via postMessage.
 *
 * Protocol:
 *   The worklet posts `ArrayBuffer` chunks (raw PCM16 LE) over `this.port`.
 *   The main thread forwards those buffers to the orchestrator WebSocket.
 */

class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.inputRate = sampleRate; // global provided by the worklet scope
    this.ratio = this.inputRate / this.targetRate;
    this.buffer = new Float32Array(0);
  }

  /**
   * Downsample a Float32 mono buffer from `inputRate` to 16000 Hz using
   * simple block averaging. Accuracy is plenty for ASR — Deepgram handles
   * the high-frequency content that matters.
   */
  downsample(float32) {
    if (this.inputRate === this.targetRate) return float32;
    const outLen = Math.floor(float32.length / this.ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const start = Math.floor(i * this.ratio);
      const end = Math.floor((i + 1) * this.ratio);
      let sum = 0;
      let count = 0;
      for (let j = start; j < end && j < float32.length; j++) {
        sum += float32[j];
        count++;
      }
      out[i] = count > 0 ? sum / count : 0;
    }
    return out;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    // Accumulate a small buffer so we emit ~20 ms frames of 16 kHz audio.
    const combined = new Float32Array(this.buffer.length + channel.length);
    combined.set(this.buffer, 0);
    combined.set(channel, this.buffer.length);
    this.buffer = combined;

    // Emit every ~20 ms at the input rate (≈ 960 samples @ 48k).
    const frameSize = Math.floor(this.inputRate * 0.02);
    while (this.buffer.length >= frameSize) {
      const chunk = this.buffer.slice(0, frameSize);
      this.buffer = this.buffer.slice(frameSize);

      const downsampled = this.downsample(chunk);
      const pcm16 = new Int16Array(downsampled.length);
      for (let i = 0; i < downsampled.length; i++) {
        const s = Math.max(-1, Math.min(1, downsampled[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      // Transfer ownership — avoids copies across the audio thread boundary.
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm-downsampler", PcmDownsampler);
