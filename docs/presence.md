# Human Mimicry Presence System

Simulates realistic human interaction timing so the bot doesn't look like a bot.

## The Problem

A bot that instantly shows "typing..." and replies in 200ms is obviously non-human. Deterministic timing patterns degrade the conversational experience.

## 4-Phase Flow

```
1. SEEN          2. READ DELAY      3. TYPING           4. REPLY
[msg arrives] → [blue ticks] → [typing... with pauses] → [send]
```

1. **Seen**: send read receipt (blue ticks) immediately
2. **Read delay**: pause scaled by message length (`msPerReadChar * chars`), clamped to `readDelayMs` bounds
3. **Typing with flicker**: typing indicator ON, with random pauses (OFF/ON) at `pauseChance` probability
4. **Reply padding**: if the AI was faster than `wpm` typing speed, pad with more typing flicker

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Master switch |
| `sendSeen` | `boolean` | `true` | Send read receipts |
| `wpm` | `number` | `42` | Simulated typing speed (words/min) |
| `readDelayMs` | `[min, max]` | `[500, 4000]` | Read delay clamp range (ms) |
| `msPerReadChar` | `number` | `30` | Base read time per character |
| `typingDurationMs` | `[min, max]` | `[1500, 15000]` | Total typing duration range |
| `pauseChance` | `number` | `0.3` | Probability of pausing each interval |
| `pauseDurationMs` | `[min, max]` | `[500, 2000]` | Pause duration range |
| `pauseIntervalMs` | `[min, max]` | `[2000, 5000]` | Interval between pause checks |
| `jitter` | `[min, max]` | `[0.7, 1.3]` | Random multiplier on all durations |

## Jitter

Every duration is multiplied by a random value in `[jitter[0], jitter[1]]`. With `[0.7, 1.3]`, a 2000ms delay becomes 1400–2600ms. This prevents timing fingerprinting.

## AI Fast vs Slow

- **AI finishes in 2s, human estimate is 8s**: presence pads 6s of typing flicker
- **AI finishes in 12s, human estimate is 8s**: no padding, reply sends immediately
