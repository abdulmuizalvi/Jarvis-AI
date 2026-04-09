/**
 * JARVIS Orb — futuristic 3D presence indicator.
 *
 * Scene layers (back → front):
 *   1. ParticleCloud   — 120 floating dots orbiting the core
 *   2. GlowShell       — transparent additive sphere for inner bloom
 *   3. OrbitalRing ×3  — independently spinning torus rings
 *   4. WireShell       — rotating wireframe overlay
 *   5. CoreSphere      — main icosahedron (metallic)
 *   6. ScanPulse       — expanding ring burst when JARVIS speaks
 */

import { Canvas, useFrame } from "@react-three/fiber";
import { useRef, useMemo, useEffect, useState } from "react";
import * as THREE from "three";
import type { SessionState, AffectState } from "../hooks/useVoiceSession";
import { getDevice } from "../lib/device";

// ─── colours per state ────────────────────────────────────────────────────
const C: Record<SessionState, string> = {
  idle:      "#0a1f35",
  listening: "#00c8ff",
  thinking:  "#a855f7",
  speaking:  "#00ffaa",
};

// ─── Particle Cloud ───────────────────────────────────────────────────────
function ParticleCloud({
  convState,
  state,
  count,
}: {
  convState: "ambient" | "engaged";
  state: SessionState;
  count: number;
}) {
  const ref = useRef<THREE.Points>(null);
  const COUNT = count;

  const positions = useMemo(() => {
    const arr = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const r = 1.9 + Math.random() * 1.0;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [COUNT]);

  const color = useMemo(() => new THREE.Color(C[state]), [state]);
  const matRef = useRef<THREE.PointsMaterial>(null);

  useFrame((_, dt) => {
    if (!ref.current || !matRef.current) return;
    ref.current.rotation.y += dt * (convState === "engaged" ? 0.09 : 0.04);
    ref.current.rotation.x += dt * 0.02;
    const targetOpacity = convState === "engaged" ? 0.85 : 0.25;
    matRef.current.opacity += (targetOpacity - matRef.current.opacity) * 0.05;
    matRef.current.color.lerp(color, 0.04);
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={COUNT}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        size={0.025}
        color={C[state]}
        transparent
        opacity={0.25}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

// ─── Glow Shell ───────────────────────────────────────────────────────────
function GlowShell({ state }: { state: SessionState }) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const color = useMemo(() => new THREE.Color(C[state]), [state]);

  useFrame(() => {
    if (!matRef.current) return;
    matRef.current.color.lerp(color, 0.06);
  });

  return (
    <mesh>
      <sphereGeometry args={[1.38, 32, 32]} />
      <meshBasicMaterial
        ref={matRef}
        color={C[state]}
        transparent
        opacity={0.06}
        side={THREE.BackSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

// ─── Orbital Ring ─────────────────────────────────────────────────────────
function OrbitalRing({
  radius,
  tube,
  tiltX,
  tiltZ,
  speed,
  state,
  opacity,
}: {
  radius: number;
  tube: number;
  tiltX: number;
  tiltZ: number;
  speed: number;
  state: SessionState;
  opacity: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef  = useRef<THREE.MeshBasicMaterial>(null);
  const color   = useMemo(() => new THREE.Color(C[state]), [state]);

  useFrame((_, dt) => {
    if (!meshRef.current || !matRef.current) return;
    meshRef.current.rotation.z += dt * speed;
    matRef.current.color.lerp(color, 0.06);
  });

  return (
    <mesh ref={meshRef} rotation={[tiltX, 0, tiltZ]}>
      <torusGeometry args={[radius, tube, 4, 96]} />
      <meshBasicMaterial
        ref={matRef}
        color={C[state]}
        transparent
        opacity={opacity}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

// ─── Wireframe Shell ──────────────────────────────────────────────────────
function WireShell({ state }: { state: SessionState }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef  = useRef<THREE.MeshBasicMaterial>(null);
  const color   = useMemo(() => new THREE.Color(C[state]), [state]);

  useFrame((_, dt) => {
    if (!meshRef.current || !matRef.current) return;
    meshRef.current.rotation.y -= dt * 0.18;
    meshRef.current.rotation.x += dt * 0.06;
    matRef.current.color.lerp(color, 0.06);
  });

  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[1.28, 2]} />
      <meshBasicMaterial
        ref={matRef}
        color={C[state]}
        wireframe
        transparent
        opacity={0.18}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

// ─── Core Sphere ──────────────────────────────────────────────────────────
function CoreSphere({
  state,
  affect,
  convState,
}: {
  state: SessionState;
  affect: AffectState;
  convState: "ambient" | "engaged";
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef  = useRef<THREE.MeshStandardMaterial>(null);
  const color   = useMemo(() => new THREE.Color(C[state]), [state]);

  useFrame((_, dt) => {
    if (!meshRef.current || !matRef.current) return;

    // Pulse scale
    const t = performance.now() * 0.001;
    const rate  = convState === "engaged" ? 2.2 + affect.arousal * 1.8 : 1.1;
    const depth = convState === "engaged" ? 0.045 : 0.018;
    meshRef.current.scale.setScalar(1 + Math.sin(t * rate) * depth);

    // Slow rotation
    meshRef.current.rotation.y += dt * (convState === "engaged" ? 0.28 : 0.14);
    meshRef.current.rotation.x += dt * 0.05;

    // Color + emissive
    matRef.current.color.lerp(color, 0.07);
    matRef.current.emissive.lerp(color, 0.07);

    const targetEmissive =
      state === "speaking" ? 1.4 :
      state === "thinking" ? 0.9 :
      convState === "engaged" ? 0.55 : 0.3;
    matRef.current.emissiveIntensity +=
      (targetEmissive - matRef.current.emissiveIntensity) * 0.08;
  });

  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[1.18, 5]} />
      <meshStandardMaterial
        ref={matRef}
        color={C[state]}
        emissive={C[state]}
        emissiveIntensity={0.3}
        roughness={0.15}
        metalness={0.85}
      />
    </mesh>
  );
}

// ─── Scan Pulse ───────────────────────────────────────────────────────────
function ScanPulse({ active }: { active: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef  = useRef<THREE.MeshBasicMaterial>(null);
  const scaleRef = useRef(0.5);

  useFrame((_, dt) => {
    if (!meshRef.current || !matRef.current) return;
    if (active) {
      scaleRef.current += dt * 1.8;
      if (scaleRef.current > 3.5) scaleRef.current = 0.5;
    } else {
      scaleRef.current = 0.5;
    }
    meshRef.current.scale.setScalar(scaleRef.current);
    matRef.current.opacity = active
      ? Math.max(0, 0.7 - (scaleRef.current - 0.5) / 3.2)
      : 0;
  });

  return (
    <mesh ref={meshRef} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[1.5, 0.012, 4, 128]} />
      <meshBasicMaterial
        ref={matRef}
        color="#00ffaa"
        transparent
        opacity={0}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

// ─── Second scan pulse (offset phase) ────────────────────────────────────
function ScanPulse2({ active }: { active: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef  = useRef<THREE.MeshBasicMaterial>(null);
  const scaleRef = useRef(2.0); // offset from ScanPulse1

  useFrame((_, dt) => {
    if (!meshRef.current || !matRef.current) return;
    if (active) {
      scaleRef.current += dt * 1.8;
      if (scaleRef.current > 3.5) scaleRef.current = 0.5;
    } else {
      scaleRef.current = 2.0;
    }
    meshRef.current.scale.setScalar(scaleRef.current);
    matRef.current.opacity = active
      ? Math.max(0, 0.5 - (scaleRef.current - 0.5) / 3.5)
      : 0;
  });

  return (
    <mesh ref={meshRef} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[1.5, 0.008, 4, 128]} />
      <meshBasicMaterial
        ref={matRef}
        color="#00ffaa"
        transparent
        opacity={0}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

// ─── Scene ────────────────────────────────────────────────────────────────
export function Orb({
  state,
  affect,
  convState,
}: {
  state: SessionState;
  affect: AffectState;
  convState: "ambient" | "engaged";
}) {
  const speaking = state === "speaking";
  const device = getDevice();

  // Reactive sizing — fit the orb to viewport so the 3D scene always
  // stays inside the HUD frame regardless of device. We key off width
  // (not just isMobile) so DevTools resize and real mobiles both work.
  // Landscape vs portrait is handled separately because the bottom
  // controls reserve a different amount of vertical space in each.
  const computeSize = () => {
    if (typeof window === "undefined") return 380;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const narrow = w <= 820;
    if (!narrow) return 380;
    const landscape = w > h;
    // Portrait narrow stacks controls vertically (~290 px reserve).
    // Landscape narrow keeps controls in a row (~150 px reserve).
    const reserve = landscape ? 150 : 290;
    const maxByWidth = w * (landscape ? 0.55 : 0.78);
    const maxByHeight = h - reserve;
    return Math.max(180, Math.min(maxByWidth, maxByHeight, 320));
  };

  const [size, setSize] = useState(computeSize);

  useEffect(() => {
    const onResize = () => setSize(computeSize());
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  // Scale scene complexity. Treat narrow viewport as "needs lighter scene"
  // even when the UA isn't mobile (e.g. DevTools responsive mode).
  const narrowVp = typeof window !== "undefined" && window.innerWidth <= 820;
  const tier = device.perfTier === "low" ? "low" : narrowVp && device.perfTier === "high" ? "mid" : device.perfTier;
  const particleCount = tier === "low" ? 45 : tier === "mid" ? 80 : 130;
  const showWireShell = tier !== "low";
  const showGlowShell = tier !== "low";
  // Mid tier keeps 2 rings, low drops to 1.
  const ringCount = tier === "high" ? 3 : tier === "mid" ? 2 : 1;
  // Cap DPR so iPhones don't render at 3× and tank the frame rate.
  const dpr: [number, number] = tier === "low" ? [1, 1] : tier === "mid" ? [1, 1.5] : [1, 2];

  return (
    <div style={{ width: size, height: size, position: "relative" }}>
      <Canvas
        camera={{ position: [0, 0, 4], fov: 42 }}
        gl={{ antialias: tier !== "low", alpha: true, powerPreference: "high-performance" }}
        dpr={dpr}
        style={{ background: "transparent" }}
      >
        <ambientLight intensity={convState === "engaged" ? 0.5 : 0.25} />
        <pointLight position={[5, 5, 5]}  intensity={convState === "engaged" ? 1.8 : 1.0} />
        <pointLight position={[-4, -3, 3]} intensity={0.6} color="#4488ff" />
        {tier !== "low" && (
          <pointLight position={[0, 5, -4]}  intensity={0.4} color="#aa44ff" />
        )}

        {/* Back → front render order */}
        <ParticleCloud convState={convState} state={state} count={particleCount} />
        {showGlowShell && <GlowShell state={state} />}

        {/* Orbital rings — scale count by tier */}
        {ringCount >= 1 && (
          <OrbitalRing radius={1.72} tube={0.008} tiltX={0} tiltZ={0} speed={0.55}
            state={state} opacity={convState === "engaged" ? 0.55 : 0.20} />
        )}
        {ringCount >= 2 && (
          <OrbitalRing radius={1.58} tube={0.007} tiltX={Math.PI / 2} tiltZ={0} speed={-0.38}
            state={state} opacity={convState === "engaged" ? 0.45 : 0.18} />
        )}
        {ringCount >= 3 && (
          <OrbitalRing radius={1.65} tube={0.006} tiltX={Math.PI / 3.5} tiltZ={0.8} speed={0.72}
            state={state} opacity={convState === "engaged" ? 0.38 : 0.14} />
        )}

        {showWireShell && <WireShell state={state} />}
        <CoreSphere state={state} affect={affect} convState={convState} />

        {/* Speaking pulse rings */}
        <ScanPulse  active={speaking} />
        {tier !== "low" && <ScanPulse2 active={speaking} />}
      </Canvas>
    </div>
  );
}
