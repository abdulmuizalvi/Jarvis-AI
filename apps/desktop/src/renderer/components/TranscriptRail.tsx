export function TranscriptRail({
  transcript,
  response,
  convState,
  narrow = false,
}: {
  transcript: string;
  response: string;
  convState: "ambient" | "engaged";
  narrow?: boolean;
}) {
  const hasContent = transcript || response;
  if (!hasContent) return null;

  return (
    <div style={{
      position: "absolute",
      // Stay above the controls + iPhone home indicator
      bottom: `calc(${narrow ? 170 : 120}px + env(safe-area-inset-bottom))`,
      width: narrow ? "92%" : "min(520px, 80%)",
      maxHeight: narrow ? "30vh" : "none",
      overflowY: narrow ? "auto" : "visible",
      display: "flex",
      flexDirection: "column",
      gap: 8,
      padding: narrow ? "0 4px" : 0,
    }}>
      {/* User utterance */}
      {transcript && (
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
        }}>
          <div style={{
            fontSize: 9,
            letterSpacing: 1.5,
            color: convState === "engaged"
              ? "rgba(0,220,180,0.5)"
              : "rgba(0,180,255,0.35)",
            textTransform: "uppercase",
            paddingTop: 2,
            minWidth: 20,
            transition: "color 0.4s",
          }}>
            {transcript.startsWith("◦") ? "·" : "you"}
          </div>
          <div style={{
            fontSize: 12,
            color: transcript.startsWith("◦")
              ? "rgba(0,180,255,0.2)"
              : "rgba(180,220,255,0.6)",
            letterSpacing: 0.3,
            lineHeight: 1.5,
            fontWeight: 300,
            fontStyle: transcript.startsWith("◦") ? "italic" : "normal",
            transition: "color 0.4s",
          }}>
            {transcript.startsWith("◦") ? transcript.slice(2) : transcript}
          </div>
        </div>
      )}

      {/* JARVIS response */}
      {response && (
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
        }}>
          <div style={{
            fontSize: 9,
            letterSpacing: 1.5,
            color: "rgba(0,220,180,0.7)",
            textTransform: "uppercase",
            paddingTop: 2,
            minWidth: 20,
          }}>
            J
          </div>
          <div style={{
            fontSize: 14,
            color: "#e8f6ff",
            letterSpacing: 0.2,
            lineHeight: 1.6,
            fontWeight: 300,
          }}>
            {response}
          </div>
        </div>
      )}
    </div>
  );
}
