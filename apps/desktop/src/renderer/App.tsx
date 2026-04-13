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

/** Privacy consent — stored in localStorage. */
function useConsent() {
  const KEY = "jarvis_consent";
  const [consent, setConsent] = useState<"pending" | "accepted" | "declined">(() => {
    if (typeof window === "undefined") return "pending";
    return (localStorage.getItem(KEY) as "accepted" | "declined") ?? "pending";
  });
  const accept = () => { localStorage.setItem(KEY, "accepted"); setConsent("accepted"); };
  const decline = () => { localStorage.setItem(KEY, "declined"); setConsent("declined"); };
  return { consent, accept, decline };
}

/** User name — asked once after consent, stored in localStorage. */
function useUserName() {
  const KEY = "jarvis_user_name";
  const [name, setName] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(KEY);
  });
  const saveName = (n: string) => {
    const trimmed = n.trim();
    if (!trimmed) return;
    localStorage.setItem(KEY, trimmed);
    setName(trimmed);
  };
  return { name, saveName, needsName: name === null };
}

export function App() {
  const { consent, accept, decline } = useConsent();
  const { name: userName, saveName, needsName } = useUserName();
  const [nameInput, setNameInput] = useState("");
  const { state, convState, affect, transcript, response, error, diag, stats, start, stop, sendText } =
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
  // Landscape narrow (e.g. phone rotated) — keep controls in a row to save
  // vertical space, but still scale touch targets up.
  const landscapeNarrow = narrow && vp.w > vp.h;
  const stackControls = narrow && !landscapeNarrow;

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

      {/* ── Stats panel (only when a session has started) ───── */}
      {state !== "idle" && !narrow && (
        <div style={{
          position: "absolute",
          // Sit just above the bottom-right "groq · llama 3.1" chip in HudFrame
          bottom: `calc(${44}px + env(safe-area-inset-bottom))`,
          right: `calc(${24}px + env(safe-area-inset-right))`,
          fontSize: 9,
          letterSpacing: 0.6,
          lineHeight: 1.55,
          color: "rgba(0,180,255,0.55)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          textTransform: "lowercase",
          textAlign: "right",
          zIndex: 40,
          pointerEvents: "none",
        }}>
          <div style={{ color: stats.micFrames > 0 ? "rgba(0,220,180,0.85)" : "rgba(255,120,120,0.85)" }}>
            mic out · {stats.micFrames}f · {(stats.micBytes / 1024).toFixed(1)}kb
          </div>
          <div style={{ color: stats.msgsIn > 0 ? "rgba(0,220,180,0.85)" : "rgba(255,120,120,0.85)" }}>
            ws in · {stats.msgsIn} msgs
          </div>
          <div>speech_chunk · {stats.speechChunks}</div>
          <div>audio_chunk · {stats.audioChunks}</div>
          <div style={{ color: stats.speechChunks > 0 && stats.ttsSpoken === 0 ? "rgba(255,180,80,0.9)" : undefined }}>
            tts spoken · {stats.ttsSpoken}
          </div>
        </div>
      )}

      {/* ── Diagnostic strip (under JARVIS title) ────────────── */}
      {diag && (
        <div style={{
          position: "absolute",
          top: `calc(${narrow ? 60 : 70}px + env(safe-area-inset-top))`,
          left: `calc(${narrow ? 14 : 24}px + env(safe-area-inset-left))`,
          fontSize: 9,
          letterSpacing: 1.2,
          color: error ? "rgba(255,120,120,0.85)" : "rgba(0,180,255,0.45)",
          textTransform: "lowercase",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          maxWidth: narrow ? "calc(100% - 28px)" : 360,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          ◆ {diag}
        </div>
      )}

      {/* ── Error banner (only if something went wrong) ─────── */}
      {error && (
        <div style={{
          position: "absolute",
          top: `calc(${narrow ? 80 : 92}px + env(safe-area-inset-top))`,
          left: "50%",
          transform: "translateX(-50%)",
          maxWidth: narrow ? "92%" : 540,
          padding: "10px 14px",
          background: "rgba(40,8,8,0.85)",
          border: "1px solid rgba(255,80,80,0.5)",
          borderRadius: 2,
          color: "#ffd0d0",
          fontSize: narrow ? 11 : 11,
          letterSpacing: 0.4,
          lineHeight: 1.45,
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          zIndex: 50,
          textAlign: "center",
        }}>
          {error}
        </div>
      )}

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
        flexDirection: stackControls ? "column" : "row",
        gap: stackControls ? 12 : 10,
        alignItems: "center",
        width: stackControls ? "90%" : "auto",
        maxWidth: 540,
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
            padding: narrow ? (landscapeNarrow ? "12px 22px" : "14px 28px") : "7px 18px",
            minHeight: narrow ? 46 : undefined,
            minWidth: narrow ? (landscapeNarrow ? 110 : 140) : undefined,
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

        {/* Divider — only when row layout */}
        {!stackControls && (
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
            padding: narrow ? (landscapeNarrow ? "12px 14px" : "14px 16px") : "7px 14px",
            borderRadius: 2,
            fontFamily: "inherit",
            // iOS auto-zooms on focus when font-size is < 16px
            fontSize: narrow ? 16 : 11,
            letterSpacing: 0.5,
            width: stackControls ? "100%" : (landscapeNarrow ? 240 : 210),
            minHeight: narrow ? 46 : undefined,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* ── Name prompt (after consent accepted, before first use) ────── */}
      {consent === "accepted" && needsName && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(2,8,16,0.92)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10000,
          backdropFilter: "blur(16px)",
        }}>
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
            padding: 40,
            maxWidth: 360,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}>
            <div style={{ fontSize: 13, color: "rgba(0,180,255,0.7)", letterSpacing: 2, textTransform: "uppercase" }}>
              Initializing
            </div>
            <div style={{ fontSize: 16, color: "rgba(200,220,240,0.9)", textAlign: "center", lineHeight: 1.6 }}>
              What should I call you?
            </div>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && nameInput.trim()) saveName(nameInput); }}
              placeholder="Your name"
              autoFocus
              style={{
                width: "100%",
                padding: "12px 16px",
                fontSize: 16,
                background: "rgba(0,180,255,0.06)",
                border: "1px solid rgba(0,180,255,0.25)",
                borderRadius: 6,
                color: "rgba(200,230,255,0.95)",
                fontFamily: "inherit",
                outline: "none",
                textAlign: "center",
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={() => { if (nameInput.trim()) saveName(nameInput); }}
              disabled={!nameInput.trim()}
              style={{
                padding: "10px 32px",
                fontSize: 12,
                fontWeight: 600,
                background: nameInput.trim() ? "rgba(0,180,255,0.15)" : "transparent",
                border: `1px solid ${nameInput.trim() ? "rgba(0,180,255,0.4)" : "rgba(255,255,255,0.1)"}`,
                color: nameInput.trim() ? "rgba(0,200,255,0.95)" : "rgba(200,220,240,0.3)",
                borderRadius: 4,
                cursor: nameInput.trim() ? "pointer" : "default",
                fontFamily: "inherit",
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* ── Privacy consent banner ────────────────── */}
      {consent === "pending" && (
        <div style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "rgba(4,12,24,0.95)",
          borderTop: "1px solid rgba(0,180,255,0.15)",
          padding: narrow ? "16px 20px" : "18px 32px",
          display: "flex",
          flexDirection: narrow ? "column" : "row",
          alignItems: narrow ? "stretch" : "center",
          gap: 14,
          zIndex: 9999,
          backdropFilter: "blur(12px)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}>
          <div style={{ flex: 1, fontSize: 12, color: "rgba(200,220,240,0.85)", lineHeight: 1.5 }}>
            JARVIS uses anonymized conversation data to improve responses over time.
            No personal data is shared externally. You can opt out and still use JARVIS — it just won't remember you across sessions.
          </div>
          <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
            <button
              onClick={accept}
              style={{
                padding: "8px 20px",
                fontSize: 11,
                fontWeight: 600,
                background: "rgba(0,180,255,0.15)",
                border: "1px solid rgba(0,180,255,0.4)",
                color: "rgba(0,200,255,0.95)",
                borderRadius: 4,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Accept
            </button>
            <button
              onClick={decline}
              style={{
                padding: "8px 20px",
                fontSize: 11,
                fontWeight: 600,
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "rgba(200,220,240,0.6)",
                borderRadius: 4,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              No thanks
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
