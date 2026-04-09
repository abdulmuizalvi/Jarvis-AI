/**
 * useVoiceSession — wires the HUD to the orchestrator's /voice WebSocket.
 *
 * Phase 1: captures microphone audio (PCM16 @ 16kHz), streams it to the
 * orchestrator, and plays back PCM24 TTS chunks via Web Audio API.
 */

import { useCallback, useEffect, useRef, useState } from "react";

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
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackQueueRef = useRef<Promise<void>>(Promise.resolve());
  const speechVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  const start = useCallback(async () => {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = async () => {
      ws.send(JSON.stringify({ type: "start" }));
      await startMicCapture();
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
          // Browser-mode TTS: speak each sentence as it streams in
          speakBrowser(msg.text);
          break;
        case "audio_chunk":
          enqueueAudio(msg.b64);
          break;
        case "tts_cancel":
          window.speechSynthesis?.cancel();
          break;
        case "ambient_logged":
          // ARIA heard us but the wake word wasn't spoken — show subtly,
          // do not speak, do not flash the response area.
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
  }, [wsUrl]);

  const stop = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "stop" }));
    wsRef.current?.close();
    stopMicCapture();
    setState("idle");
  }, []);

  const sendText = useCallback((text: string) => {
    setTranscript(text);
    setResponse("");
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: "text", text }));
    } else {
      // Auto-connect for text mode
      start().then(() => {
        setTimeout(() => {
          wsRef.current?.send(JSON.stringify({ type: "text", text }));
        }, 300);
      });
    }
  }, [start]);

  async function startMicCapture() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
    });
    micStreamRef.current = stream;

    const ctx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      if (wsRef.current?.readyState !== 1) return;
      const input = e.inputBuffer.getChannelData(0);
      const pcm16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      wsRef.current.send(pcm16.buffer);
    };

    source.connect(processor);
    processor.connect(ctx.destination);
  }

  function stopMicCapture() {
    processorRef.current?.disconnect();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    processorRef.current = null;
    micStreamRef.current = null;
    audioCtxRef.current = null;
  }

  /**
   * Browser-native TTS via Web Speech API.
   * Picks the most "ARIA-like" voice available (British male, baritone if possible)
   * and speaks each streamed sentence with prosody tuned by current affect.
   */
  function speakBrowser(text: string) {
    if (!text.trim() || typeof window === "undefined" || !window.speechSynthesis) return;

    if (!speechVoiceRef.current) {
      const voices = window.speechSynthesis.getVoices();
      // Preference order: British male → any male → en-GB → first English
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
    utter.rate = 1.0;       // ~150 wpm baseline
    utter.pitch = 0.85;     // slightly lower for baritone effect
    utter.volume = 1.0;
    window.speechSynthesis.speak(utter);
  }

  function enqueueAudio(b64: string) {
    playbackQueueRef.current = playbackQueueRef.current.then(async () => {
      const ctx = audioCtxRef.current ?? new AudioContext({ sampleRate: 24000 });
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

  // Pre-load Web Speech voices (some browsers populate asynchronously)
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
