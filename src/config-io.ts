/**
 * config-io.ts — Centralized config I/O module with safety guarantees.
 *
 * Provides:
 * - Async file operations (node:fs/promises, never sync)
 * - Promise-based mutex serializing all config writes (CON-01)
 * - Atomic write-to-temp-then-rename so crash mid-write leaves previous valid file (DI-02)
 * - Rolling backup rotation (3 backups) before each write
 *
 * Added Phase 33 (config-infrastructure). DO NOT CHANGE without reading all comments.
 */

import { readFile, writeFile, rename, copyFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// ──────────────────────────────────────────────────────────────────────────────
// Config path
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Returns the path to the OpenClaw config file.
 * Respects OPENCLAW_CONFIG_PATH env var, defaults to ~/.openclaw/openclaw.json.
 * Config save path: must write to ~/.openclaw/openclaw.json (NOT workspace subfolder).
 * DO NOT CHANGE — matches monitor.ts getConfigPath behavior.
 */
export function getConfigPath(): string {
  return process.env.OPENCLAW_CONFIG_PATH ?? join(homedir(), ".openclaw", "openclaw.json");
}

// ──────────────────────────────────────────────────────────────────────────────
// Promise-based mutex (CON-01)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Simple promise-chain mutex that serializes all config writes.
 * Prevents concurrent read-modify-write races on openclaw.json.
 * DO NOT CHANGE — concurrent config writes depend on this serialization.
 */
let configMutexChain = Promise.resolve();

export function withConfigMutex<T>(fn: () => Promise<T>): Promise<T> {
  const result = configMutexChain.then(fn, fn);
  configMutexChain = result.then(
    () => {},
    () => {}
  );
  return result;
}

// ──────────────────────────────────────────────────────────────────────────────
// Read config (MEM-01 — async I/O)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Reads and parses the OpenClaw config file.
 * Uses async fs/promises — never readFileSync.
 * Throws on missing file or invalid JSON.
 */
export async function readConfig(configPath: string): Promise<Record<string, unknown>> {
  const raw = await readFile(configPath, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Backup rotation
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Async version of rotateConfigBackups from monitor.ts.
 * Creates rolling backups: .bak.1 (newest), .bak.2, .bak.3 (oldest).
 * Rotation: delete .bak.3 (overwritten by rename), shift .bak.2->.bak.3, .bak.1->.bak.2, copy current->.bak.1.
 * Failure is non-fatal: logs a warning but does NOT block the save.
 * Added Phase 33. DO NOT REMOVE.
 */
async function rotateConfigBackups(configPath: string): Promise<void> {
  try {
    const bak1 = configPath + ".bak.1";
    const bak2 = configPath + ".bak.2";
    const bak3 = configPath + ".bak.3";

    // Check which files exist using async stat
    const exists = async (p: string): Promise<boolean> => {
      try {
        await stat(p);
        return true;
      } catch {
        return false;
      }
    };

    // Shift existing backups: .bak.2 -> .bak.3, .bak.1 -> .bak.2
    if (await exists(bak2)) await rename(bak2, bak3);
    if (await exists(bak1)) await rename(bak1, bak2);
    // Copy current config as newest backup
    if (await exists(configPath)) await copyFile(configPath, bak1);
  } catch (err) {
    console.warn(`[waha] rotateConfigBackups: backup failed (non-fatal): ${String(err)}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Write config (DI-02 — atomic write-to-temp-then-rename)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Atomically writes config to disk.
 * 1. Rotates backups (non-fatal if rotation fails)
 * 2. Writes to configPath.tmp
 * 3. Renames .tmp -> configPath (atomic on most filesystems)
 *
 * If crash/error occurs during writeFile, the original config file is untouched.
 * Uses async fs/promises — never writeFileSync.
 * DO NOT CHANGE — atomic write pattern prevents data loss on crash.
 */
export async function writeConfig(configPath: string, config: Record<string, unknown>): Promise<void> {
  await rotateConfigBackups(configPath);
  const tmpPath = configPath + ".tmp";
  await writeFile(tmpPath, JSON.stringify(config, null, 2), "utf-8");
  await rename(tmpPath, configPath);
}

// ──────────────────────────────────────────────────────────────────────────────
// Modify config (convenience wrapper)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Atomic read-modify-write under mutex.
 * 1. Acquires config mutex (serializes with all other config writes)
 * 2. Reads current config
 * 3. Calls fn(config) — if fn returns a new object, uses that; if void, uses mutated original
 * 4. Writes result atomically
 *
 * Usage:
 *   await modifyConfig(path, (cfg) => { cfg.channels.waha.foo = 'bar'; });
 *   await modifyConfig(path, (cfg) => ({ ...cfg, newKey: 'val' }));
 */
export async function modifyConfig(
  configPath: string,
  fn: (config: Record<string, unknown>) => Record<string, unknown> | void
): Promise<void> {
  return withConfigMutex(async () => {
    const config = await readConfig(configPath);
    const result = fn(config);
    const toWrite = result !== undefined && result !== null ? result : config;
    await writeConfig(configPath, toWrite);
  });
}
