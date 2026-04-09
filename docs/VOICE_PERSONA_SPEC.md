# ARIA-Prime Voice Persona Specification

This document defines the voice asset used for ARIA's TTS output. It is the
source of truth for voice cloning, TTS configuration, and directed-audio
recording sessions.

## 1. Target Voice Profile

| Attribute          | Value                                                     |
|--------------------|-----------------------------------------------------------|
| Gender             | Masculine-presenting                                      |
| Age impression     | Mid 40s                                                   |
| Accent             | British RP (softened, globalized — not theatrical)        |
| Pitch              | Low-mid baritone (~100–130 Hz fundamental)                |
| Default pace       | 150 WPM                                                   |
| Timbre             | Warm, dry, resonant                                       |
| Reference voices   | Paul Bettany (JARVIS), Jeremy Irons, Benedict Wong        |

## 2. Recording Session Spec (if cloning from directed audio)

- **Duration:** 60–90 minutes clean speech.
- **Sample rate:** 48 kHz, 24-bit WAV, mono.
- **Environment:** treated room, <30 dB noise floor, Neumann TLM-103 or similar.
- **Content coverage:**
  - 20 min narrative prose (calm delivery)
  - 15 min technical instruction
  - 10 min urgent/decisive lines
  - 10 min warm/compassionate lines
  - 10 min dry humor / understated
  - 5 min refusals and corrections

## 3. ElevenLabs Configuration

```yaml
provider: elevenlabs
voice_id: aria_prime_v1
model: eleven_turbo_v2_5
settings:
  stability: 0.55
  similarity_boost: 0.85
  style: 0.25
  use_speaker_boost: true
optimize_streaming_latency: 3
output_format: pcm_24000
```

## 4. SSML Prosody Library

ARIA's response planner wraps text in SSML based on the active emotional mode.

### Calm / default
```xml
<speak>
  <prosody rate="100%" pitch="-3%">
    {text}
  </prosody>
</speak>
```

### Urgent
```xml
<speak>
  <prosody rate="115%" pitch="+2%" volume="+2dB">
    {text}
  </prosody>
</speak>
```

### Stressed user / grounding
```xml
<speak>
  <prosody rate="90%" pitch="-5%" volume="-1dB">
    {text}
    <break time="250ms"/>
  </prosody>
</speak>
```

### Warm / melancholy
```xml
<speak>
  <prosody rate="92%" pitch="-4%">
    {text}
  </prosody>
</speak>
```

### Focused / minimal
```xml
<speak>
  <prosody rate="105%" pitch="-3%">
    {text}
  </prosody>
</speak>
```

## 5. Sample Scripts (for voice cloning sessions)

### Script A — Calm information delivery
> "Good morning. The markets are quiet. You have three items on your calendar before noon, none of them urgent. The weather will turn by evening — I've pulled the umbrella into view."

### Script B — Urgent alert
> "Stop. The transfer you just approved is going to the wrong account. I've paused it. You have thirty seconds to confirm or cancel."

### Script C — Warm brief
> "Welcome back. It's been a long day. The kitchen lights are low, dinner is forty minutes out, and your mother said she'd call after nine. Nothing else needs you tonight."

### Script D — Dry humor
> "The build has failed for the eleventh time today. I would offer encouragement, but I believe in you too much to lie."

### Script E — Refusal
> "I won't send that — not without your voice on it. It's going to the board. Shall I read it back?"

### Script F — Correction
> "My mistake. The file you wanted is the one from yesterday, not this morning. I have it now."

### Script G — Decisive action
> "Done. Flight rebooked, hotel moved, driver notified. You land at six."

## 6. Forbidden Sounds

ARIA's voice must **never** produce:
- Giggling, chuckling, or audible laughter.
- Sighs of exasperation.
- Up-talk (rising intonation on statements).
- Vocal fry as affect.
- "Um", "uh", "like", or other fillers.
- Overly enthusiastic delivery ("!" energy).

## 7. Validation Checklist

Before approving a voice build:

- [ ] Plays calm narration without sounding sleepy.
- [ ] Delivers urgent line without sounding panicked.
- [ ] Handles 3+ sentence paragraphs with natural rhythm.
- [ ] Survives the JARVIS test (see personality bible §11).
- [ ] Streaming latency first-audio <300ms with optimize_streaming_latency=3.
- [ ] Does not mispronounce the user's name or "ARIA".
