/**
 * Device / environment detection for the HUD.
 *
 * All checks run safely in SSR (returns false if `window` is undefined).
 * The values are memoized on first call — the device type cannot change
 * within a single session.
 */

type DeviceInfo = {
  isMobile: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isSafari: boolean;
  isTouch: boolean;
  /** Heuristic: "low" = fewer particles, no wireframe shell, etc. */
  perfTier: "low" | "mid" | "high";
};

let cached: DeviceInfo | null = null;

export function getDevice(): DeviceInfo {
  if (cached) return cached;
  if (typeof window === "undefined") {
    return {
      isMobile: false,
      isIOS: false,
      isAndroid: false,
      isSafari: false,
      isTouch: false,
      perfTier: "high",
    };
  }

  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ masquerades as Mac — detect via touch capability.
    (ua.includes("Mac") && "ontouchend" in document);
  const isAndroid = /android/i.test(ua);
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const viewportIsNarrow = window.innerWidth <= 820;
  const isMobile = isIOS || isAndroid || (isTouch && viewportIsNarrow);

  // Perf tier — device memory is only exposed on Chromium, fall back to cores.
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  let perfTier: "low" | "mid" | "high";
  if (isMobile && (mem <= 2 || cores <= 4)) perfTier = "low";
  else if (isMobile) perfTier = "mid";
  else perfTier = "high";

  cached = { isMobile, isIOS, isAndroid, isSafari, isTouch, perfTier };
  return cached;
}

/** Convenience — reactive layout sizing that reflows on resize. */
export function useViewport() {
  // Intentionally not using useState hooks here to avoid adding a hook dep.
  // Callers just read this once per render for cheap sizing.
  if (typeof window === "undefined") {
    return { w: 1280, h: 720, narrow: false };
  }
  return {
    w: window.innerWidth,
    h: window.innerHeight,
    narrow: window.innerWidth <= 820,
  };
}
