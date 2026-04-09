import { useVoiceSession } from "./hooks/useVoiceSession";
import { Orb }             from "./components/Orb";
import { TranscriptRail }  from "./components/TranscriptRail";
import { HudFrame }        from "./components/HudFrame";

const GATEWAY_WS = "ws://127.0.0.1:8787/voice";

const HEX_GRID = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100'%3E%3Cpath d='M28 66L0 50V16L28 0l28 16v34L28 66zM28 100L0 84V50l28-16 28 16v34L28 100z' fill='none' stroke='rgba(0%2C180%2C255%2C0.04)' stroke-width='0.5'/%3E%3C/svg%3E")`;

export function App() {
  const { state, convState, affect, transcript, response, start, stop, sendText } =
    useVoiceSession(GATEWAY_WS);

  const engaged = convState === "engaged";

  return (
    <div style={{
      width: "100%",
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      overflow: "hidden",
      background: `radial-gradient(ellipse at 50% 45%, #071828 0%, #020810 65%), ${HEX_GRID}`,
    }}>

      {/* ── Ambient radial glow behind orb ────────────────── */}
      <div style={{
        position: "absolute",
        width: 520,
        height: 520,
        borderRadius: "50%",
        background: engaged
          ? "radial-gradient(circle, rgba(0,200,140,0.07) 0%, transparent 70%)"
          : "radial-gradient(circle, rgba(0,180,255,0.05) 0%, transparent 70%)",
        transition: "background 1s ease",
        pointerEvents: "none",
      }} />

      {/* ── HUD chrome layer (brackets, arcs, scan, waveform) ─ */}
      <HudFrame state={state} convState={convState} affect={affect} />

      {/* ── JARVIS Orb ─────────────────────────────────────── */}
      <Orb state={state} affect={affect} convState={convState} />

      {/* ── Transcript + response ──────────────────────────── */}
      <TranscriptRail transcript={transcript} response={response} convState={convState} />

      {/* ── Controls ───────────────────────────────────────── */}
      <div style={{
        position: "absolute",
        bottom: 28,
        display: "flex",
        gap: 10,
        alignItems: "center",
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
            padding: "7px 18px",
            borderRadius: 2,
            fontFamily: "inherit",
            fontSize: 10,
            letterSpacing: 2.5,
            textTransform: "uppercase",
            cursor: "pointer",
            backdropFilter: "blur(10px)",
            transition: "all 0.4s",
          }}
        >
          {state === "idle" ? "engage" : "standby"}
        </button>

        {/* Divider */}
        <div style={{ width: 1, height: 20, background: "rgba(0,180,255,0.15)" }} />

        {/* Text input */}
        <input
          type="text"
          placeholder="type to jarvis..."
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.currentTarget.value.trim()) {
              sendText(e.currentTarget.value);
              e.currentTarget.value = "";
            }
          }}
          style={{
            background: "rgba(0,180,255,0.05)",
            border: "1px solid rgba(0,180,255,0.18)",
            color: "#cce8ff",
            padding: "7px 14px",
            borderRadius: 2,
            fontFamily: "inherit",
            fontSize: 11,
            letterSpacing: 0.5,
            width: 210,
            outline: "none",
          }}
        />
      </div>
    </div>
  );
}
