/**
 * HudFrame — Iron Man-inspired HUD chrome layer.
 *
 * Renders:
 *   - Corner bracket decorations
 *   - Scanning sweep line
 *   - Arc segment indicators around the orb
 *   - Waveform bars (audio visualizer simulation)
 *   - Status readout chips
 */

import { useEffect, useRef } from "react";
import type { SessionState, AffectState } from "../hooks/useVoiceSession";

// ─── Corner Bracket ───────────────────────────────────────────────────────
function Corner({
  pos,
  active,
}: {
  pos: "tl" | "tr" | "bl" | "br";
  active: boolean;
}) {
  const isRight  = pos === "tr" || pos === "br";
  const isBottom = pos === "bl" || pos === "br";
  const c = active ? "rgba(0,220,180,0.75)" : "rgba(0,180,255,0.35)";
  const size = 22;
  const thick = 1.5;

  return (
    <div style={{
      position: "absolute",
      [isBottom ? "bottom" : "top"]: 0,
      [isRight  ? "right"  : "left"]: 0,
      width: size,
      height: size,
      transition: "opacity 0.5s, border-color 0.5s",
    }}>
      {/* Horizontal bar */}
      <div style={{
        position: "absolute",
        [isBottom ? "bottom" : "top"]: 0,
        [isRight  ? "right"  : "left"]: 0,
        width: size,
        height: thick,
        background: c,
        transition: "background 0.5s",
      }} />
      {/* Vertical bar */}
      <div style={{
        position: "absolute",
        [isBottom ? "bottom" : "top"]: 0,
        [isRight  ? "right"  : "left"]: 0,
        width: thick,
        height: size,
        background: c,
        transition: "background 0.5s",
      }} />
    </div>
  );
}

// ─── Waveform Bars ───────────────────────────────────────────────────────
function WaveformBars({
  state,
  convState,
}: {
  state: SessionState;
  convState: "ambient" | "engaged";
}) {
  const BAR_COUNT = 20;
  const heightsRef = useRef<number[]>(Array(BAR_COUNT).fill(4));
  const barsRef = useRef<HTMLDivElement[]>([]);
  const rafRef = useRef<number>(0);

  const isActive = state === "listening" || state === "speaking" || state === "thinking";

  useEffect(() => {
    const animate = () => {
      heightsRef.current = heightsRef.current.map((h, i) => {
        if (!isActive) return Math.max(4, h - 1.5);
        const target =
          state === "speaking" ? 4 + Math.random() * 28 :
          state === "thinking" ? 4 + Math.abs(Math.sin(Date.now() * 0.003 + i * 0.5)) * 18 :
          4 + Math.random() * 10;
        return h + (target - h) * 0.35;
      });

      barsRef.current.forEach((el, i) => {
        if (el) el.style.height = `${heightsRef.current[i]}px`;
      });

      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [state, isActive]);

  const barColor =
    state === "speaking" ? "#00ffaa" :
    state === "thinking" ? "#a855f7" :
    convState === "engaged" ? "#00c8ff" : "rgba(0,180,255,0.3)";

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 3,
      height: 36,
    }}>
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <div
          key={i}
          ref={el => { if (el) barsRef.current[i] = el; }}
          style={{
            width: 3,
            height: 4,
            background: barColor,
            borderRadius: 2,
            transition: "background 0.4s",
            opacity: isActive ? 1 : 0.3,
          }}
        />
      ))}
    </div>
  );
}

// ─── Scan Line ────────────────────────────────────────────────────────────
function ScanLine({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div style={{
      position: "absolute",
      left: 0,
      right: 0,
      height: 1,
      background: "linear-gradient(90deg, transparent, rgba(0,220,255,0.6), transparent)",
      animation: "scanline 3s linear infinite",
      pointerEvents: "none",
    }} />
  );
}

// ─── Arc indicator (SVG arc segment) ─────────────────────────────────────
function ArcIndicators({ state, convState }: { state: SessionState; convState: "ambient" | "engaged" }) {
  const color =
    state === "speaking" ? "#00ffaa" :
    state === "thinking" ? "#a855f7" : "#00c8ff";
  const opacity = convState === "engaged" ? 0.7 : 0.2;
  const size = 420;
  const r = 200;
  const cx = size / 2;
  const cy = size / 2;

  const arc = (startDeg: number, endDeg: number) => {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const x1 = cx + r * Math.cos(toRad(startDeg));
    const y1 = cy + r * Math.sin(toRad(startDeg));
    const x2 = cx + r * Math.cos(toRad(endDeg));
    const y2 = cy + r * Math.sin(toRad(endDeg));
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  // 4 short arc segments at compass positions
  const segments = [
    { start: -20, end: 20 },    // top
    { start: 70,  end: 110 },   // right
    { start: 160, end: 200 },   // bottom
    { start: 250, end: 290 },   // left
  ];

  return (
    <div style={{
      position: "absolute",
      width: size,
      height: size,
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      pointerEvents: "none",
      transition: "opacity 0.5s",
      opacity,
    }}>
      <svg width={size} height={size} style={{ position: "absolute" }}>
        {segments.map((s, i) => (
          <path
            key={i}
            d={arc(s.start - 90, s.end - 90)}
            stroke={color}
            strokeWidth={1.5}
            fill="none"
            strokeLinecap="round"
            style={{ transition: "stroke 0.5s" }}
          />
        ))}
      </svg>
    </div>
  );
}

// ─── Status Chip ─────────────────────────────────────────────────────────
function StatusChip({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 2,
      opacity: active ? 1 : 0.35,
      transition: "opacity 0.5s",
    }}>
      <div style={{ fontSize: 8, letterSpacing: 1.8, color: "rgba(0,200,255,0.5)", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 11, letterSpacing: 1.2, color: "#cceeff", textTransform: "uppercase" }}>{value}</div>
    </div>
  );
}

// ─── Main HUD Frame ───────────────────────────────────────────────────────
export function HudFrame({
  state,
  convState,
  affect,
}: {
  state: SessionState;
  convState: "ambient" | "engaged";
  affect: AffectState;
}) {
  const engaged = convState === "engaged";
  const active  = state !== "idle";

  return (
    <>
      {/* Inject keyframe animations into head once */}
      <style>{`
        @keyframes scanline {
          0%   { top: -2px; opacity: 0; }
          5%   { opacity: 1; }
          95%  { opacity: 0.4; }
          100% { top: 100%; opacity: 0; }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.2; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Arc segments around orb */}
      <ArcIndicators state={state} convState={convState} />

      {/* Scan line */}
      <ScanLine active={state === "thinking"} />

      {/* ── Top-left info block ─────────────────────────────────── */}
      <div style={{
        position: "absolute",
        top: 22,
        left: 24,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}>
        {/* Main title */}
        <div style={{
          fontSize: 13,
          letterSpacing: 3,
          color: engaged ? "rgba(0,240,180,0.9)" : "rgba(0,180,255,0.55)",
          textTransform: "uppercase",
          fontWeight: 300,
          transition: "color 0.6s",
        }}>
          JARVIS
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* Engagement dot */}
          <div style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: engaged ? "#00ffaa" : "rgba(0,180,255,0.3)",
            boxShadow: engaged ? "0 0 8px #00ffaa" : "none",
            animation: engaged ? "blink 2s ease-in-out infinite" : "none",
            transition: "background 0.5s, box-shadow 0.5s",
          }} />
          <div style={{
            fontSize: 9,
            letterSpacing: 2,
            color: engaged ? "rgba(0,240,180,0.7)" : "rgba(0,180,255,0.35)",
            textTransform: "uppercase",
            transition: "color 0.5s",
          }}>
            {engaged ? "engaged" : "ambient"}
          </div>
        </div>
      </div>

      {/* ── Top-right status chips ──────────────────────────────── */}
      <div style={{
        position: "absolute",
        top: 22,
        right: 24,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 6,
      }}>
        <StatusChip label="mode"   value={state}      active={active} />
        <StatusChip label="affect" value={affect.mode} active={active} />
      </div>

      {/* ── Full-screen corner brackets ─────────────────────────── */}
      <div style={{ position: "absolute", inset: 16, pointerEvents: "none" }}>
        <Corner pos="tl" active={engaged} />
        <Corner pos="tr" active={engaged} />
        <Corner pos="bl" active={engaged} />
        <Corner pos="br" active={engaged} />
      </div>

      {/* ── Bottom waveform + wake hint ─────────────────────────── */}
      <div style={{
        position: "absolute",
        bottom: 78,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}>
        <WaveformBars state={state} convState={convState} />
        {active && !engaged && (
          <div style={{
            fontSize: 9,
            letterSpacing: 2.5,
            color: "rgba(0,180,255,0.3)",
            textTransform: "uppercase",
            animation: "fadeIn 0.4s ease",
          }}>
            say "jarvis" to engage
          </div>
        )}
      </div>

      {/* ── Bottom-left memory indicator ────────────────────────── */}
      <div style={{
        position: "absolute",
        bottom: 22,
        left: 24,
        fontSize: 8,
        letterSpacing: 1.8,
        color: "rgba(0,180,255,0.25)",
        textTransform: "uppercase",
      }}>
        mem active
      </div>

      {/* ── Bottom-right latency indicator ──────────────────────── */}
      <div style={{
        position: "absolute",
        bottom: 22,
        right: 24,
        fontSize: 8,
        letterSpacing: 1.8,
        color: "rgba(0,180,255,0.25)",
        textTransform: "uppercase",
      }}>
        groq · llama 3.1
      </div>
    </>
  );
}
