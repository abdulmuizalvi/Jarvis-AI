/**
 * useVoiceSession — wires the HUD to the orchestrator's /voice WebSocket.
 *
 * Mobile-first rewrite:
 *   - Uses AudioWorklet (not the deprecated ScriptProcessorNode) — works on
 *     iOS Safari and modern Chrome Android.
 *   - AudioContext is created synchronously inside the user-gesture callback
 *     so Safari does not block audio playback.
 *   - Downsamples the mic stream to 16kHz PCM16 inside the worklet regardless
 *     of device sample rate (iOS always gives us 48000).
 *   - Primes the Web Speech API on first tap so iOS allows subsequent TTS.
 *   - Cleans up AudioContext on stop() so the HUD tab can be reused.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getDevice } from "../lib/device";

export type SessionState = "idle" | "listening" | "thinking" | "speaking";

export interface AffectState {
  valence: number;
  arousal: number;
  stress: number;
  urgency: number;
  mode: string;
}

export function useVoiceSession(wsUrl: string) {
  const [state, setState] = useState<SessionState>("idle");
  const [convState, setConvState] = useState<"ambient" | "engaged">("ambient");
  const [affect, setAffect] = useState<AffectState>({
    valence: 0, arousal: 0.3, stress: 0, urgency: 0, mode: "calm",
  });
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const playbackQueueRef = useRef<Promise<void>>(Promise.resolve());
  const speechVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const ttsUnlockedRef = useRef<boolean>(false);

  const device = getDevice();

  /**
   * Prime the Web Speech API on the very first user tap — iOS Safari blocks
   * all TTS until the page receives a *direct* user gesture that calls
   * `speechSynthesis.speak()` at least once. We speak an empty utterance to
   * unlock the queue without making any noise.
   */
  const unlockSpeech = useCallback(() => {
    if (ttsUnlockedRef.current) return;
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      const silent = new SpeechSynthesisUtterance(" ");
      silent.volume = 0;
      silent.rate = 1;
      window.speechSynthesis.speak(silent);
      ttsUnlockedRef.current = true;
    } catch {
      /* ignore */
    }
  }, []);

  /**
   * Also prime the playback AudioContext synchronously inside the click —
   * Safari only grants audio permission when the context is created inside
   * the user gesture stack. We create it here, then resume() it so it's
   * ready to queue `audio_chunk` messages that arrive later.
   */
  const ensurePlaybackCtx = useCallback(() => {
    if (playbackCtxRef.current && playbackCtxRef.current.state !== "closed") {
      if (playbackCtxRef.current.state === "suspended") {
        playbackCtxRef.current.resume().catch(() => {});
      }
      return playbackCtxRef.current;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ sampleRate: 24000 });
    // iOS starts contexts in "suspended" state until the gesture resumes them.
    ctx.resume().catch(() => {});
    playbackCtxRef.current = ctx;
    return ctx;
  }, []);

  const start = useCallback(async () => {
    // Must run synchronously with the user gesture for iOS.
    unlockSpeech();
    ensurePlaybackCtx();

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = async () => {
      ws.send(JSON.stringify({ type: "start" }));
      try {
        await startMicCapture();
      } catch (err) {
        console.warn("[voice] mic capture failed", err);
      }
      setState("listening");
    };

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      switch (msg.type) {
        case "state": setState(msg.state); break;
        case "conv_state": setConvState(msg.conv); break;
        case "affect": setAffect(msg.affect); break;
        case "partial_transcript":
        case "final_transcript":
          setTranscript(msg.text);
          if (msg.type === "final_transcript") setResponse("");
          break;
        case "speech_chunk":
          setResponse((prev) => prev + msg.text);
          speakBrowser(msg.text);
          break;
        case "audio_chunk":
          enqueueAudio(msg.b64);
          break;
        case "tts_cancel":
          window.speechSynthesis?.cancel();
          break;
        case "ambient_logged":
          setTranscript(`◦ ${msg.text}`);
          break;
        case "done":
          break;
      }
    };

    ws.onclose = () => {
      stopMicCapture();
      setState("idle");
    };
  }, [wsUrl, unlockSpeech, ensurePlaybackCtx]);

  const stop = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "stop" }));
    wsRef.current?.close();
    stopMicCapture();
    // Keep playback context alive so a future start() inherits the unlock,
    // but pause it to save power.
    playbackCtxRef.current?.suspend().catch(() => {});
    setState("idle");
  }, []);

  const sendText = useCallback((text: string) => {
    unlockSpeech();
    ensurePlaybackCtx();
    setTranscript(text);
    setResponse("");
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "text", text }));
    } else {
      start().then(() => {
        setTimeout(() => {
          wsRef.current?.send(JSON.stringify({ type: "text", text }));
        }, 300);
      });
    }
  }, [start, unlockSpeech, ensurePlaybackCtx]);

  async function startMicCapture() {
    // Ask for the mic with echo cancellation and noise suppression — the
    // device will pick its own sample rate (iOS: 48000, desktop: 44100).
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    micStreamRef.current = stream;

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    micCtxRef.current = ctx;
    await ctx.resume();

    // Load the PCM downsampler worklet. `/pcm-worklet.js` lives in /public.
    try {
      await ctx.audioWorklet.addModule("/pcm-worklet.js");
    } catch (err) {
      console.error("[voice] failed to load pcm-worklet.js", err);
      throw err;
    }

    const source = ctx.createMediaStreamSource(stream);
    micSourceRef.current = source;

    const node = new AudioWorkletNode(ctx, "pcm-downsampler");
    workletNodeRef.current = node;

    node.port.onmessage = (ev: MessageEvent) => {
      if (wsRef.current?.readyState !== 1) return;
      // The worklet transfers an ArrayBuffer of PCM16LE — forward as binary.
      wsRef.current.send(ev.data as ArrayBuffer);
    };

    source.connect(node);
    // We must connect to destination (or a GainNode with gain=0) so the
    // worklet actually pumps. Silence it so we don't create feedback.
    const silence = ctx.createGain();
    silence.gain.value = 0;
    node.connect(silence).connect(ctx.destination);
  }

  function stopMicCapture() {
    try { workletNodeRef.current?.disconnect(); } catch { /* ignore */ }
    try { micSourceRef.current?.disconnect(); } catch { /* ignore */ }
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micCtxRef.current?.close().catch(() => {});
    workletNodeRef.current = null;
    micSourceRef.current = null;
    micStreamRef.current = null;
    micCtxRef.current = null;
  }

  /**
   * Browser-native TTS via Web Speech API.
   * On iOS the voice must be selected AFTER the voiceschanged event fires
   * and only within a gesture-adjacent code path — our unlockSpeech() earlier
   * handles the first-tap requirement.
   */
  function speakBrowser(text: string) {
    if (!text.trim() || typeof window === "undefined" || !window.speechSynthesis) return;

    if (!speechVoiceRef.current) {
      const voices = window.speechSynthesis.getVoices();
      speechVoiceRef.current =
        voices.find((v) => /en-GB/i.test(v.lang) && /male|daniel|george|oliver|arthur/i.test(v.name)) ??
        voices.find((v) => /en-GB/i.test(v.lang)) ??
        voices.find((v) => /male|david|mark|guy/i.test(v.name)) ??
        voices.find((v) => /^en/i.test(v.lang)) ??
        voices[0] ??
        null;
    }

    const utter = new SpeechSynthesisUtterance(text);
    if (speechVoiceRef.current) utter.voice = speechVoiceRef.current;
    // iOS ignores pitch entirely — set it anyway for desktop warmth.
    utter.rate = device.isIOS ? 1.05 : 1.0;
    utter.pitch = device.isIOS ? 1.0 : 0.85;
    utter.volume = 1.0;
    window.speechSynthesis.speak(utter);
  }

  function enqueueAudio(b64: string) {
    playbackQueueRef.current = playbackQueueRef.current.then(async () => {
      const ctx = playbackCtxRef.current ?? ensurePlaybackCtx();
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});

      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const pcm = new Int16Array(bytes.buffer);
      const float = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) float[i] = pcm[i] / 32768;

      const buffer = ctx.createBuffer(1, float.length, 24000);
      buffer.copyToChannel(float, 0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start();
      await new Promise<void>((resolve) => { src.onended = () => resolve(); });
    });
  }

  // Pre-load Web Speech voices (some browsers populate asynchronously).
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0 && !speechVoiceRef.current) {
        speechVoiceRef.current =
          voices.find((v) => /en-GB/i.test(v.lang) && /male|daniel|george|oliver|arthur/i.test(v.name)) ??
          voices.find((v) => /en-GB/i.test(v.lang)) ??
          voices.find((v) => /male|david|mark|guy/i.test(v.name)) ??
          voices.find((v) => /^en/i.test(v.lang)) ??
          voices[0] ??
          null;
      }
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { state, convState, affect, transcript, response, start, stop, sendText };
}
