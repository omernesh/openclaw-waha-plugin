/**
 * Structured JSON logger for WAHA OpenClaw Plugin.
 *
 * Outputs one JSON line per log call with consistent fields:
 * level, ts, component, msg, and any extra context.
 *
 * Phase 35 (OBS-01). DO NOT REMOVE — foundation for all structured logging.
 *
 * Usage:
 *   import { logger } from "./logger.js";
 *   const log = logger.child({ component: "monitor" });
 *   log.info("server started", { port: 3004 });
 *
 * @module logger
 */

// --- Log level types and priority ---

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// --- Logger interface ---

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
  /** Internal — current configured level. Used by setLogLevel. */
  _level: LogLevel;
}

// --- Factory ---

/**
 * Create a structured JSON logger.
 *
 * @param opts.level - Minimum log level (default: WAHA_LOG_LEVEL env or "info")
 * @param opts.component - Component name added to every log line
 * @param opts[key] - Any additional fields merged into every log line
 */
export function createLogger(
  opts?: { level?: LogLevel; [key: string]: unknown }
): Logger {
  const {
    level: configLevel,
    ...fields
  } = opts ?? {};

  let currentLevel: LogLevel =
    configLevel ??
    (isValidLevel(process.env.WAHA_LOG_LEVEL) ? process.env.WAHA_LOG_LEVEL as LogLevel : "info");

  function emit(
    level: LogLevel,
    msg: string,
    extra?: Record<string, unknown>
  ): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel]) return;

    const line = JSON.stringify({
      level,
      ts: new Date().toISOString(),
      ...fields,
      msg,
      ...extra,
    }) + "\n";

    // info/debug → stdout; warn/error → stderr
    if (level === "debug" || level === "info") {
      process.stdout.write(line);
    } else {
      process.stderr.write(line);
    }
  }

  const logger: Logger = {
    debug: (msg, extra) => emit("debug", msg, extra),
    info: (msg, extra) => emit("info", msg, extra),
    warn: (msg, extra) => emit("warn", msg, extra),
    error: (msg, extra) => emit("error", msg, extra),
    child(childFields) {
      return createLogger({
        level: currentLevel,
        ...fields,
        ...childFields,
      });
    },
    get _level() {
      return currentLevel;
    },
    set _level(l: LogLevel) {
      currentLevel = l;
    },
  };

  return logger;
}

// --- Helpers ---

function isValidLevel(val: string | undefined): val is LogLevel {
  return val !== undefined && val in LEVEL_PRIORITY;
}

/**
 * Change the log level of an existing logger at runtime.
 * Used when config loads after module initialization.
 */
export function setLogLevel(loggerInstance: Logger, level: LogLevel): void {
  loggerInstance._level = level;
}

// --- Default singleton ---
// Reads WAHA_LOG_LEVEL from environment; defaults to "info".
// DO NOT REMOVE — imported by all source files after Phase 35 migration.
export const logger: Logger = createLogger();
