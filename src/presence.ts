import { sendWahaPresence, sendWahaSeen } from "./send.js";
import { sleep, warnOnError } from "./http-client.js";
import type { CoreConfig, PresenceConfig } from "./types.js";

/** Hard ceiling: never flicker longer than this (safety net for leaked loops). */
const MAX_FLICKER_MS = 90_000;

const DEFAULTS: Required<PresenceConfig> = {
  enabled: true,
  sendSeen: true,
  wpm: 42,
  readDelayMs: [500, 4000],
  msPerReadChar: 30,
  typingDurationMs: [1500, 15000],
  pauseChance: 0.3,
  pauseDurationMs: [500, 2000],
  pauseIntervalMs: [2000, 5000],
  jitter: [0.7, 1.3],
};

function resolvePresenceConfig(cfg: CoreConfig): Required<PresenceConfig> {
  const raw = cfg.channels?.waha?.presence;
  if (!raw) return DEFAULTS;
  return {
    enabled: raw.enabled ?? DEFAULTS.enabled,
    sendSeen: raw.sendSeen ?? DEFAULTS.sendSeen,
    wpm: raw.wpm ?? DEFAULTS.wpm,
    readDelayMs: raw.readDelayMs ?? DEFAULTS.readDelayMs,
    msPerReadChar: raw.msPerReadChar ?? DEFAULTS.msPerReadChar,
    typingDurationMs: raw.typingDurationMs ?? DEFAULTS.typingDurationMs,
    pauseChance: raw.pauseChance ?? DEFAULTS.pauseChance,
    pauseDurationMs: raw.pauseDurationMs ?? DEFAULTS.pauseDurationMs,
    pauseIntervalMs: raw.pauseIntervalMs ?? DEFAULTS.pauseIntervalMs,
    jitter: raw.jitter ?? DEFAULTS.jitter,
  };
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function calcReadDelay(incomingText: string, cfg: Required<PresenceConfig>): number {
  const chars = incomingText.length;
  const base = chars * cfg.msPerReadChar;
  const jittered = base * rand(cfg.jitter[0], cfg.jitter[1]);
  return clamp(jittered, cfg.readDelayMs[0], cfg.readDelayMs[1]);
}

function calcTypingDuration(replyText: string, cfg: Required<PresenceConfig>): number {
  const chars = replyText.length;
  const charsPerSecond = (cfg.wpm * 5) / 60;
  const baseMs = (chars / charsPerSecond) * 1000;
  const jittered = baseMs * rand(cfg.jitter[0], cfg.jitter[1]);
  return clamp(jittered, cfg.typingDurationMs[0], cfg.typingDurationMs[1]);
}

export async function startHumanPresence(params: {
  cfg: CoreConfig;
  chatId: string;
  messageId?: string;
  incomingText: string;
  accountId?: string;
}): Promise<PresenceController> {
  const { cfg, chatId, messageId, incomingText, accountId } = params;
  const presenceCfg = resolvePresenceConfig(cfg);

  if (!presenceCfg.enabled) {
    await sendWahaPresence({ cfg, chatId, typing: true, accountId }).catch(warnOnError(`presence typing-start ${chatId}`));
    return {
      finishTyping: async (_replyText?: string) => {
        await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(warnOnError(`presence typing-stop ${chatId}`));
      },
      cancelTyping: async () => {
        await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(warnOnError(`presence typing-stop ${chatId}`));
      },
    };
  }

  if (presenceCfg.sendSeen && messageId) {
    await sendWahaSeen({ cfg, chatId, accountId }).catch(warnOnError(`presence seen ${chatId}`));
  }

  const readDelay = calcReadDelay(incomingText, presenceCfg);
  await sleep(readDelay);

  await sendWahaPresence({ cfg, chatId, typing: true, accountId }).catch(warnOnError(`presence typing-start ${chatId}`));
  const typingStartedAt = Date.now();

  let flickerAborted = false;
  // Hard ceiling: never flicker longer than MAX_FLICKER_MS (safety net for leaked loops)
  const flickerPromise = (async () => {
    while (!flickerAborted && Date.now() - typingStartedAt < MAX_FLICKER_MS) {
      const interval = rand(presenceCfg.pauseIntervalMs[0], presenceCfg.pauseIntervalMs[1]);
      await sleep(interval);
      if (flickerAborted || Date.now() - typingStartedAt >= MAX_FLICKER_MS) break;

      if (Math.random() < presenceCfg.pauseChance) {
        await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(warnOnError(`presence typing-stop ${chatId}`));
        const pauseDuration = rand(presenceCfg.pauseDurationMs[0], presenceCfg.pauseDurationMs[1]);
        await sleep(pauseDuration);
        if (flickerAborted || Date.now() - typingStartedAt >= MAX_FLICKER_MS) break;
        await sendWahaPresence({ cfg, chatId, typing: true, accountId }).catch(warnOnError(`presence typing-start ${chatId}`));
      }
    }
    // Guarantee typing is stopped when loop exits
    await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(warnOnError(`presence typing-stop ${chatId}`));
  })();

  let finishTypingDone = false;

  return {
    finishTyping: async (replyText?: string) => {
      // Subsequent calls (e.g., voice after text) — just stop typing immediately
      if (finishTypingDone) {
        await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(warnOnError(`presence typing-stop ${chatId}`));
        return;
      }

      flickerAborted = true;
      await flickerPromise; // Wait for in-flight flicker to drain
      await sleep(100); // drain delay for protocol to settle
      finishTypingDone = true;
      await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(warnOnError(`presence typing-stop ${chatId}`));
    },
    cancelTyping: async () => {
      flickerAborted = true;
      await flickerPromise; // Wait for in-flight flicker to drain
      await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(warnOnError(`presence typing-stop ${chatId}`));
    },
  };
}

export type PresenceController = {
  finishTyping: (replyText?: string) => Promise<void>;
  cancelTyping: () => Promise<void>;
};
