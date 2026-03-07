import { sendWahaPresence, sendWahaSeen } from "./send.js";
import type { CoreConfig, PresenceConfig } from "./types.js";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function typingFlickerLoop(params: {
  cfg: Required<PresenceConfig>;
  coreCfg: CoreConfig;
  chatId: string;
  accountId?: string;
  durationMs: number;
  startedAt: number;
}): Promise<void> {
  const { cfg, coreCfg, chatId, accountId, durationMs, startedAt } = params;
  const deadline = startedAt + durationMs;

  while (Date.now() < deadline) {
    const interval = rand(cfg.pauseIntervalMs[0], cfg.pauseIntervalMs[1]);
    const remaining = deadline - Date.now();
    if (remaining <= 500) break;

    await sleep(Math.min(interval, remaining));
    if (Date.now() >= deadline) break;

    if (Math.random() < cfg.pauseChance) {
      await sendWahaPresence({ cfg: coreCfg, chatId, typing: false, accountId }).catch(() => {});
      const pauseDuration = rand(cfg.pauseDurationMs[0], cfg.pauseDurationMs[1]);
      const pauseRemaining = deadline - Date.now();
      if (pauseRemaining <= 0) break;
      await sleep(Math.min(pauseDuration, pauseRemaining));
      if (Date.now() >= deadline) break;
      await sendWahaPresence({ cfg: coreCfg, chatId, typing: true, accountId }).catch(() => {});
    }
  }
  // Guarantee typing is stopped on exit — loop may have resumed typing:true just before deadline
  await sendWahaPresence({ cfg: coreCfg, chatId, typing: false, accountId }).catch(() => {});
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
    await sendWahaPresence({ cfg, chatId, typing: true, accountId }).catch(() => {});
    return {
      finishTyping: async (_replyText?: string) => {
        await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(() => {});
      },
      cancelTyping: async () => {
        await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(() => {});
      },
    };
  }

  if (presenceCfg.sendSeen && messageId) {
    await sendWahaSeen({ cfg, chatId, accountId }).catch(() => {});
  }

  const readDelay = calcReadDelay(incomingText, presenceCfg);
  await sleep(readDelay);

  await sendWahaPresence({ cfg, chatId, typing: true, accountId }).catch(() => {});
  const typingStartedAt = Date.now();

  let flickerAborted = false;
  const flickerPromise = (async () => {
    while (!flickerAborted) {
      const interval = rand(presenceCfg.pauseIntervalMs[0], presenceCfg.pauseIntervalMs[1]);
      await sleep(interval);
      if (flickerAborted) break;

      if (Math.random() < presenceCfg.pauseChance) {
        await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(() => {});
        const pauseDuration = rand(presenceCfg.pauseDurationMs[0], presenceCfg.pauseDurationMs[1]);
        await sleep(pauseDuration);
        if (flickerAborted) break;
        await sendWahaPresence({ cfg, chatId, typing: true, accountId }).catch(() => {});
      }
    }
  })();

  let finishTypingDone = false;

  return {
    finishTyping: async (replyText?: string) => {
      // Subsequent calls (e.g., voice after text) — just stop typing immediately
      if (finishTypingDone) {
        await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(() => {});
        return;
      }

      flickerAborted = true;
      await flickerPromise; // Wait for in-flight flicker to drain

      if (replyText) {
        const humanTypingTime = calcTypingDuration(replyText, presenceCfg);
        const elapsed = Date.now() - typingStartedAt;

        if (elapsed < humanTypingTime) {
          // Simple sleep — typing indicator is already on, no need to re-send typing:true
          await sleep(humanTypingTime - elapsed);
        }
      }

      finishTypingDone = true;
      await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(() => {});
    },
    cancelTyping: async () => {
      flickerAborted = true;
      await flickerPromise; // Wait for in-flight flicker to drain
      await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(() => {});
    },
  };
}

export type PresenceController = {
  finishTyping: (replyText?: string) => Promise<void>;
  cancelTyping: () => Promise<void>;
};
