/**
 * Conversation flow test.
 * Simulates 4 utterances via the voice path (manual UtteranceEnd signal).
 */
import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:8787/voice");
const log = (tag, msg) => console.log(`[${tag}]`, typeof msg === "object" ? JSON.stringify(msg) : msg);

const tests = [
  { label: "1. NO wake word (should be ambient_logged, silent)", text: "I was just thinking about that project deadline" },
  { label: "2. WAKE WORD + question (should engage + respond)", text: "jarvis what time is it right now and how is the weather looking" },
  { label: "3. Follow-up WITHOUT wake word (should still respond, engaged)", text: "and what about tomorrow's forecast" },
  { label: "4. Talking to someone else (should disengage)", text: "Hey Michael, can you grab those files from the printer" },
  { label: "5. After disengage, no wake word (should be silent again)", text: "I'll head over there in a minute" },
];

let step = 0;
let convState = "ambient";

async function sendUtterance(text) {
  return new Promise(resolve => {
    let fragments = text.match(/\b\w+(?:\s\w+){0,6}\b/g) ?? [text];
    let done = false;

    // Send as final_fragments then UtteranceEnd simulation via JSON
    ws.send(JSON.stringify({ type: "utterance_test", text }));

    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "conv_state") {
        convState = msg.conv;
        log("conv_state", msg.conv);
      } else if (msg.type === "ambient_logged") {
        log("SILENT (ambient)", msg.text);
        if (!done) { done = true; ws.off("message", handler); resolve(); }
      } else if (msg.type === "speech_chunk") {
        process.stdout.write(msg.text);
      } else if (msg.type === "done") {
        console.log();
        if (!done) { done = true; ws.off("message", handler); resolve(); }
      } else if (msg.type !== "partial_transcript" && msg.type !== "state" && msg.type !== "affect") {
        log(msg.type, msg.text || msg.state || msg.conv || "");
      }
    };

    ws.on("message", handler);
    setTimeout(() => { if (!done) { done = true; ws.off("message", handler); resolve(); } }, 15000);
  });
}

ws.on("open", async () => {
  log("connected", "starting conversation test");
  ws.send(JSON.stringify({ type: "start" }));
  await new Promise(r => setTimeout(r, 500));

  for (const t of tests) {
    console.log(`\n${"─".repeat(60)}\n${t.label}\n> "${t.text}"\nconv_state at start: ${convState}`);
    await sendUtterance(t.text);
    await new Promise(r => setTimeout(r, 1200));
  }

  console.log("\n\n=== TEST COMPLETE ===");
  ws.close();
  process.exit(0);
});

ws.on("error", e => { console.error("WS ERROR:", e.message); process.exit(1); });
