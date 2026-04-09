import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:8787/voice");
let audioChunks = 0;
let speechText = "";
let affectSeen = null;
let firstTokenAt = 0;
let firstAudioAt = 0;
const startedAt = Date.now();

const timeout = setTimeout(() => {
  console.log("\nTIMEOUT");
  ws.close();
  process.exit(1);
}, 45000);

ws.on("open", () => {
  console.log("[connected]");
  ws.send(JSON.stringify({ type: "start" }));
  setTimeout(() => {
    console.log("[sending text]");
    ws.send(
      JSON.stringify({
        type: "text",
        text: "Hello ARIA. Introduce yourself in one sentence.",
      }),
    );
  }, 300);
});

let doneSeen = false;
let audioFinishTimer = null;

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === "audio_chunk") {
    audioChunks++;
    if (!firstAudioAt) firstAudioAt = Date.now();
    if (audioFinishTimer) clearTimeout(audioFinishTimer);
    if (doneSeen) audioFinishTimer = setTimeout(finish, 1500);
    return;
  }

  if (msg.type === "speech_chunk") {
    if (!firstTokenAt) firstTokenAt = Date.now();
    speechText += msg.text;
    return;
  }

  if (msg.type === "affect") affectSeen = msg.affect;

  console.log(
    "<-",
    msg.type,
    msg.type === "affect"
      ? JSON.stringify(msg.affect)
      : msg.state || msg.text || "",
  );

  if (msg.type === "done") {
    doneSeen = true;
    audioFinishTimer = setTimeout(finish, 6000);
  }
});

function finish() {
  console.log("\n=== RESPONSE ===");
  console.log(speechText.trim());
  console.log("\n=== STATS ===");
  console.log(`first token  : ${firstTokenAt ? firstTokenAt - startedAt + "ms" : "none"}`);
  console.log(`first audio  : ${firstAudioAt ? firstAudioAt - startedAt + "ms" : "none"}`);
  console.log(`audio chunks : ${audioChunks}`);
  console.log(`affect mode  : ${affectSeen?.mode}`);
  clearTimeout(timeout);
  ws.close();
  process.exit(0);
}

ws.on("error", (e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
