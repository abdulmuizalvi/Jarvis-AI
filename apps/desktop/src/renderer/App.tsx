import { useEffect, useState } from "react";
import { useVoiceSession } from "./hooks/useVoiceSession";
import { Orb }             from "./components/Orb";
import { TranscriptRail }  from "./components/TranscriptRail";
import { HudFrame }        from "./components/HudFrame";
import { getDevice }       from "./lib/device";

// Gateway WebSocket URL.
//   - Production: set VITE_GATEWAY_WS in your host's env (e.g. Vercel)
//                 to wss://<your-railway>.up.railway.app/voice
//   - Dev:        falls back to local orchestrator on 127.0.0.1:8787
const GATEWAY_WS =
  (import.meta.env.VITE_GATEWAY_WS as string | undefined) ??
  (import.meta.env.PROD
    ? "wss://jarvisdemo.up.railway.app/voice"
    : "ws://127.0.0.1:8787/voice");

const HEX_GRID = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100'%3E%3Cpath d='M28 66L0 50V16L28 0l28 16v34L28 66zM28 100L0 84V50l28-16 28 16v34L28 100z' fill='none' stroke='rgba(0%2C180%2C255%2C0.04)' stroke-width='0.5'/%3E%3C/svg%3E")`;

export function App() {
  const { state, convState, affect, transcript, response, start, stop, sendText } =
    useVoiceSession(GATEWAY_WS);

  const engaged = convState === "engaged";
  const device = getDevice();

  // Reactive viewport — recomputes on resize/orientation change so the
  // layout picks up rotation and Safari chrome show/hide.
  const [vp, setVp] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1280,
    h: typeof window !== "undefined" ? window.innerHeight : 720,
  }));

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  const narrow = vp.w <= 820;

  return (
    <div style={{
      width: "100%",
      height: "100vh",
      // dvh prevents the mobile browser's address bar from clipping content
      maxHeight: "100dvh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      overflow: "hidden",
      background: `radial-gradient(ellipse at 50% 45%, #071828 0%, #020810 65%), ${HEX_GRID}`,
      // Respect iPhone notch / home indicator
      paddingTop: "env(safe-area-inset-top)",
      paddingBottom: "env(safe-area-inset-bottom)",
      paddingLeft: "env(safe-area-inset-left)",
      paddingRight: "env(safe-area-inset-right)",
    }}>

      {/* ── Ambient radial glow behind orb ────────────────── */}
      <div style={{
        position: "absolute",
        width: narrow ? 360 : 520,
        height: narrow ? 360 : 520,
        borderRadius: "50%",
        background: engaged
          ? "radial-gradient(circle, rgba(0,200,140,0.07) 0%, transparent 70%)"
          : "radial-gradient(circle, rgba(0,180,255,0.05) 0%, transparent 70%)",
        transition: "background 1s ease",
        pointerEvents: "none",
      }} />

      {/* ── HUD chrome layer (brackets, arcs, scan, waveform) ─ */}
      <HudFrame state={state} convState={convState} affect={affect} narrow={narrow} />

      {/* ── JARVIS Orb ─────────────────────────────────────── */}
      <Orb state={state} affect={affect} convState={convState} />

      {/* ── Transcript + response ──────────────────────────── */}
      <TranscriptRail transcript={transcript} response={response} convState={convState} narrow={narrow} />

      {/* ── Controls ───────────────────────────────────────── */}
      <div style={{
        position: "absolute",
        // Push above safe-area inset on iPhone
        bottom: `calc(${narrow ? 20 : 28}px + env(safe-area-inset-bottom))`,
        display: "flex",
        flexDirection: narrow ? "column" : "row",
        gap: narrow ? 12 : 10,
        alignItems: "center",
        width: narrow ? "90%" : "auto",
        maxWidth: 420,
      }}>
        {/* Engage / Standby button */}
        <button
          onClick={state === "idle" ? start : stop}
          style={{
            background: engaged
              ? "rgba(0,200,140,0.12)"
              : "rgba(0,180,255,0.10)",
            border: `1px solid ${engaged ? "rgba(0,220,180,0.5)" : "rgba(0,180,255,0.35)"}`,
            color: engaged ? "rgba(0,240,180,0.9)" : "rgba(0,180,255,0.75)",
            // iOS HIG — minimum 44×44 touch target
            padding: narrow ? "14px 28px" : "7px 18px",
            minHeight: narrow ? 48 : undefined,
            minWidth: narrow ? 140 : undefined,
            borderRadius: 2,
            fontFamily: "inherit",
            fontSize: narrow ? 12 : 10,
            letterSpacing: 2.5,
            textTransform: "uppercase",
            cursor: "pointer",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            transition: "all 0.4s",
            // Prevent text selection on double-tap
            WebkitUserSelect: "none",
            userSelect: "none",
          }}
        >
          {state === "idle" ? "engage" : "standby"}
        </button>

        {/* Divider — horizontal on narrow, vertical on wide */}
        {!narrow && (
          <div style={{ width: 1, height: 20, background: "rgba(0,180,255,0.15)" }} />
        )}

        {/* Text input */}
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="type to jarvis..."
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.currentTarget.value.trim()) {
              sendText(e.currentTarget.value);
              e.currentTarget.value = "";
              // Dismiss iOS keyboard after send
              if (device.isIOS) e.currentTarget.blur();
            }
          }}
          style={{
            background: "rgba(0,180,255,0.05)",
            border: "1px solid rgba(0,180,255,0.18)",
            color: "#cce8ff",
            padding: narrow ? "14px 16px" : "7px 14px",
            borderRadius: 2,
            fontFamily: "inherit",
            // iOS auto-zooms on focus when font-size is < 16px
            fontSize: narrow ? 16 : 11,
            letterSpacing: 0.5,
            width: narrow ? "100%" : 210,
            minHeight: narrow ? 48 : undefined,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>
    </div>
  );
}
