// SYNC ENGINE — DO NOT CHANGE
//
// Background directory synchronization. Pulls contacts, groups, and newsletters
// from WAHA into SQLite on a configurable interval.
//
// Uses setTimeout chain (NOT setInterval) — prevents pile-up on slow WAHA APIs.
// Pattern copied from health.ts (Phase 2).
//
// The sync data pipeline is extracted from monitor.ts POST /api/admin/directory/refresh
// (Phase 13, 2026-03-17). Both must stay in sync — if the pipeline changes here,
// update the monitor.ts handler too (or better: have monitor.ts call triggerImmediateSync).

import { getConfigPath, modifyConfig } from "./config-io.js";
import { getDirectoryDb } from "./directory.js";
import {
  getWahaChats, getWahaContacts, getWahaGroups, getWahaAllLids,
  getWahaChannels, getWahaContact, getWahaNewsletter, toArr
} from "./send.js";
import type { CoreConfig } from "./types.js";

// RateLimiter extracted to src/rate-limiter.ts (Phase review, 2026-03-17). DO NOT DUPLICATE.
import { RateLimiter } from "./rate-limiter.js";

// ── Types ────────────────────────────────────────────────────────────

/** Live sync state for one account — updated in-place by tick(). */
export interface SyncState {
  status: "idle" | "running" | "error";
  lastSyncAt: number | null;
  lastSyncDuration: number | null;
  itemsSynced: number;
  /** Which phase the sync cycle is currently in: "contacts" | "groups" | "newsletters" | "names" | null */
  currentPhase: "contacts" | "groups" | "newsletters" | "names" | null;
  lastError: string | null;
}

/** Options for starting a background sync loop. */
export interface SyncOptions {
  accountId: string;
  config: CoreConfig;
  intervalMs: number;
  abortSignal: AbortSignal;
}

// ── Module-level state ───────────────────────────────────────────────

/** Per-account sync state. Keyed by accountId. */
const syncStates = new Map<string, SyncState>();

/** Per-account timer handle for the setTimeout chain. Used by triggerImmediateSync(). */
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Per-account opts. Stored by startDirectorySync, read by triggerImmediateSync. */
const syncOpts = new Map<string, SyncOptions>();

// ── Helpers ──────────────────────────────────────────────────────────

/** Call .unref() on a timer so it doesn't keep the process alive. */
function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as NodeJS.Timeout).unref();
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Start the background directory sync loop for one account.
 *
 * Returns a mutable SyncState reference that is updated in-place on each
 * sync cycle. The caller can read state.status / state.lastSyncAt at any time.
 *
 * The loop uses a setTimeout chain: schedules next sync only after the current
 * cycle completes, preventing pile-up when WAHA is slow. All timers are .unref()'d
 * so they don't block process shutdown.
 *
 * @param opts - Sync configuration including accountId, config, intervalMs, abortSignal
 * @returns Mutable SyncState reference
 */
export function startDirectorySync(opts: SyncOptions): SyncState {
  const state: SyncState = {
    status: "idle",
    lastSyncAt: null,
    lastSyncDuration: null,
    itemsSynced: 0,
    currentPhase: null,
    lastError: null,
  };

  syncStates.set(opts.accountId, state);
  syncOpts.set(opts.accountId, opts);

  // Clean up all maps when aborted (prevent memory leak for long-running processes)
  opts.abortSignal.addEventListener("abort", () => {
    syncStates.delete(opts.accountId);
    syncTimers.delete(opts.accountId);
    syncOpts.delete(opts.accountId);
  }, { once: true });

  // Schedule first tick after 2s delay — don't block startup
  const timer = setTimeout(() => {
    tick(opts, state);
  }, 2000);

  unrefTimer(timer);
  syncTimers.set(opts.accountId, timer);

  return state;
}

/**
 * Get the current sync state for an account.
 * Returns undefined if no sync has been started for that account.
 */
export function getSyncState(accountId: string): SyncState | undefined {
  return syncStates.get(accountId);
}

/**
 * Trigger an immediate sync cycle for an account, bypassing the normal interval.
 * Useful after a manual directory refresh to bring the background loop in sync.
 *
 * If a cycle is already running, does nothing (the current cycle will naturally
 * schedule the next one when it completes).
 */
export function triggerImmediateSync(accountId: string): void {
  const state = syncStates.get(accountId);
  const opts = syncOpts.get(accountId);
  if (!state || !opts) return;  // sync not started yet

  // If already running, let the current cycle finish — it will schedule the next timer
  if (state.status === "running") return;

  // Cancel pending timer and trigger immediately
  const existing = syncTimers.get(accountId);
  if (existing !== undefined) clearTimeout(existing);

  void tick(opts, state);
}

// ── Private implementation ─────────────────────────────────────────────

/** Single sync tick: run one full cycle then schedule the next. */
async function tick(opts: SyncOptions, state: SyncState): Promise<void> {
  if (opts.abortSignal.aborted) return;

  const startTime = Date.now();
  state.status = "running";

  try {
    const itemsSynced = await runSyncCycle(opts, state);
    const endTime = Date.now();
    state.status = "idle";
    state.lastSyncAt = endTime;
    state.lastSyncDuration = endTime - startTime;
    state.itemsSynced = itemsSynced;
    state.lastError = null;
  } catch (err: unknown) {
    state.status = "error";
    state.lastError = err instanceof Error ? err.message : String(err);
    state.lastSyncDuration = Date.now() - startTime;
    console.warn(`[waha] sync: cycle failed for account ${opts.accountId}: ${state.lastError}`);
  }

  state.currentPhase = null;

  // Schedule next tick (setTimeout chain — NOT setInterval)
  if (!opts.abortSignal.aborted) {
    const nextTimer = setTimeout(() => {
      tick(opts, state);
    }, opts.intervalMs);

    unrefTimer(nextTimer);
    syncTimers.set(opts.accountId, nextTimer);
  }
}

/**
 * TTL-03: Remove expired JIDs from the openclaw.json allowFrom array.
 * This is the critical bridge between SQLite TTL expiry and the config-based inbound filter.
 * Without this, expired entries remain in allowFrom and inbound continues to grant access.
 * DO NOT REMOVE — closing this gap is what makes TTL enforcement actually work.
 */
async function syncExpiredToConfig(expiredJids: string[]): Promise<number> {
  if (expiredJids.length === 0) return 0;
  const configPath = getConfigPath();
  let removed = 0;
  try {
    await modifyConfig(configPath, (config) => {
      const channels = (config.channels as Record<string, unknown>) ?? {};
      const waha = (channels.waha as Record<string, unknown>) ?? {};
      const allowFrom = (Array.isArray(waha.allowFrom) ? waha.allowFrom : []).filter((x): x is string => typeof x === 'string');
      for (const jid of expiredJids) {
        const idx = allowFrom.indexOf(jid);
        if (idx >= 0) {
          allowFrom.splice(idx, 1);
          removed++;
        }
      }
      if (removed > 0) {
        waha.allowFrom = allowFrom;
        config.channels = { ...channels, waha };
      }
    });
    return removed;
  } catch (err) {
    console.error(`[waha] sync: syncExpiredToConfig failed: ${String(err)}`);
    return -1;
  }
}

/**
 * Run one full sync cycle: contacts → groups → newsletters → name resolution.
 *
 * Extracted from monitor.ts POST /api/admin/directory/refresh (lines 4031-4243).
 * The pipeline is preserved exactly — same catch handlers, same LID merge logic,
 * same name resolution batching. DO NOT CHANGE without updating monitor.ts too.
 *
 * @returns Total number of items synced (contacts + groups + newsletters + namesResolved)
 */
async function runSyncCycle(opts: SyncOptions, state: SyncState): Promise<number> {
  const db = getDirectoryDb(opts.accountId);
  const rateLimiter = new RateLimiter(3, 200);

  // ── Phase 1: Contacts & Groups ──────────────────────────────────────
  state.currentPhase = "contacts";

  // Fetch bulk data with rate limiting — same as monitor.ts refresh handler
  // Track API failures so we can report partial sync errors. DO NOT CHANGE.
  let apiFailures = 0;
  const [rawChats, rawContacts, rawGroups, rawLids] = await Promise.all([
    rateLimiter.run(() => getWahaChats({ cfg: opts.config, accountId: opts.accountId }).catch((err: unknown) => { apiFailures++; console.warn(`[waha] sync: getWahaChats failed: ${String(err)}`); return []; })),
    rateLimiter.run(() => getWahaContacts({ cfg: opts.config, accountId: opts.accountId }).catch((err: unknown) => { apiFailures++; console.warn(`[waha] sync: getWahaContacts failed: ${String(err)}`); return []; })),
    rateLimiter.run(() => getWahaGroups({ cfg: opts.config, accountId: opts.accountId }).catch((err: unknown) => { apiFailures++; console.warn(`[waha] sync: getWahaGroups failed: ${String(err)}`); return []; })),
    rateLimiter.run(() => getWahaAllLids({ cfg: opts.config, accountId: opts.accountId }).catch((err: unknown) => { apiFailures++; console.warn(`[waha] sync: getWahaAllLids failed: ${String(err)}`); return []; })),
  ]);
  if (apiFailures > 0) {
    state.lastError = `${apiFailures} of 4 API calls failed`;
  }

  const chatsArr = toArr(rawChats);
  const contactsArr = toArr(rawContacts);
  const groupsArr = toArr(rawGroups);
  const lidsArr = toArr(rawLids);

  // Build LID -> @c.us mapping from the WAHA LID API and contacts API
  const lidToCus = new Map<string, string>();
  for (const entry of lidsArr) {
    const rec = entry as Record<string, unknown>;
    const lid = String(rec.lid ?? rec.id ?? "");
    const phone = String(rec.pn ?? rec.phone ?? rec.contactId ?? "");
    if (lid && lid.endsWith("@lid") && phone) {
      const cusJid = phone.includes("@") ? phone : `${phone}@c.us`;
      lidToCus.set(lid, cusJid);
    }
  }
  // Also build from contacts API (contacts may have linkedDevices or server-reported LIDs)
  for (const c of contactsArr) {
    const rec = c as Record<string, unknown>;
    const jid = String(rec.id ?? "");
    if (!jid || !jid.endsWith("@c.us")) continue;
    const lid = (rec.lid as string) || (rec.linkedDeviceId as string) || undefined;
    if (lid && lid.endsWith("@lid")) {
      lidToCus.set(lid, jid);
    }
  }

  // NAME-01: Persist LID-to-@c.us mapping to ALL account DBs so resolveJids() and getContact()
  // can resolve @lid JIDs to their @c.us display names. LID mappings are global (same WAHA
  // instance), so every account DB needs them — otherwise dashboards for non-syncing accounts
  // show raw @lid JIDs. The @lid number is completely different from the @c.us number —
  // this mapping is the ONLY way to bridge them. DO NOT CHANGE.
  const lidMappings = Array.from(lidToCus.entries()).map(([lid, cus]) => ({ lid, cus }));
  if (lidMappings.length > 0) {
    // Write to current account's DB
    db.bulkUpsertLidMappings(lidMappings);
    // Write to all OTHER active account DBs so their dashboards can resolve @lid JIDs too.
    // LID mappings are global (same WAHA instance serves all sessions). DO NOT REMOVE.
    for (const [otherId] of syncStates) {
      if (otherId !== opts.accountId) {
        try {
          const otherDb = getDirectoryDb(otherId);
          otherDb.bulkUpsertLidMappings(lidMappings);
        } catch { /* non-critical — other account DB may not be ready yet */ }
      }
    }
  }

  // Build contact map from chats (primary source — always works on NOWEB)
  const contactMap = new Map<string, { jid: string; name?: string; isGroup: boolean }>();
  for (const c of chatsArr) {
    const rec = c as Record<string, unknown>;
    const jid = String(rec.id ?? "");
    if (!jid) continue;
    const isGroup = jid.endsWith("@g.us");
    const name = (rec.name as string) || undefined;
    contactMap.set(jid, { jid, name, isGroup });
  }

  // Merge contacts API results (prefer contact name over chat name)
  for (const c of contactsArr) {
    const rec = c as Record<string, unknown>;
    const jid = String(rec.id ?? "");
    if (!jid) continue;
    const name = (rec.name as string) || (rec.pushName as string) || undefined;
    const existing = contactMap.get(jid);
    if (existing) {
      if (name) existing.name = name;
    } else {
      contactMap.set(jid, { jid, name, isGroup: jid.endsWith("@g.us") });
    }
  }

  // Add groups from groups API (use subject for name)
  state.currentPhase = "groups";
  for (const g of groupsArr) {
    const rec = g as Record<string, unknown>;
    const jid = String(rec.id ?? "");
    if (!jid) continue;
    const name = (rec.subject as string) || (rec.name as string) || undefined;
    const existing = contactMap.get(jid);
    if (existing) {
      if (name) existing.name = name;
      existing.isGroup = true;
    } else {
      contactMap.set(jid, { jid, name, isGroup: true });
    }
  }

  // Normalize @s.whatsapp.net → @c.us (same person, different format)
  for (const [jid, entry] of contactMap) {
    if (!jid.endsWith("@s.whatsapp.net")) continue;
    const cusJid = jid.replace("@s.whatsapp.net", "@c.us");
    const cusEntry = contactMap.get(cusJid);
    if (cusEntry) {
      if (!cusEntry.name && entry.name) cusEntry.name = entry.name;
    } else {
      contactMap.set(cusJid, { jid: cusJid, name: entry.name, isGroup: entry.isGroup });
    }
    contactMap.delete(jid);
  }

  // Merge @lid entries into their @c.us counterparts using the LID map
  for (const [jid, entry] of contactMap) {
    if (!jid.endsWith("@lid")) continue;
    const cusJid = lidToCus.get(jid);
    if (cusJid) {
      const cusEntry = contactMap.get(cusJid);
      if (cusEntry) {
        if (!cusEntry.name && entry.name) cusEntry.name = entry.name;
      } else {
        contactMap.set(cusJid, { jid: cusJid, name: entry.name, isGroup: false });
      }
    }
    contactMap.delete(jid);
  }

  // Filter out any remaining @lid and @s.whatsapp.net entries, then bulkUpsert
  const filteredEntries = [...contactMap.values()].filter((e) => !e.jid.endsWith("@lid") && !e.jid.endsWith("@s.whatsapp.net"));
  const mappedContacts = filteredEntries.filter((e) => !e.isGroup);
  const mappedGroups = filteredEntries.filter((e) => e.isGroup);
  const imported = db.bulkUpsertContacts(filteredEntries);

  // Merge existing @lid and @s.whatsapp.net DB entries into their @c.us counterparts.
  // getContacts() filters these out at SQL level (AP-02 fix), so we use getOrphanedLidEntries()
  // to explicitly fetch only the ghost JID entries that need merging.
  // DO NOT CHANGE — getContacts() never returns @lid/@s.whatsapp.net entries so the old
  // db.getContacts({ limit: 10000 }) call was dead code.
  let lidsMerged = 0;
  try {
    const orphanedEntries = db.getOrphanedLidEntries();
    for (const c of orphanedEntries) {
      if (c.jid.endsWith("@lid")) {
        const cusJid = lidToCus.get(c.jid);
        if (cusJid) {
          db.mergeContacts(c.jid, cusJid);
          lidsMerged++;
        }
      } else if (c.jid.endsWith("@s.whatsapp.net")) {
        const cusJid = c.jid.replace("@s.whatsapp.net", "@c.us");
        db.mergeContacts(c.jid, cusJid);
        lidsMerged++;
      }
    }
  } catch (mergeErr) {
    console.warn(`[waha] sync: LID merge partially failed: ${String(mergeErr)}`);
  }

  // Participants are loaded lazily when user clicks a group (not during bulk refresh)

  if (opts.abortSignal.aborted) return mappedContacts.length + mappedGroups.length;

  // Phase 1b (per-JID phone-to-LID lookups) removed 2026-03-17.
  // The bulk GET /api/{session}/lids endpoint now returns ALL mappings reliably,
  // making individual lookups unnecessary. DO NOT RESTORE — bulk is much more efficient.

  // ── Phase 2: Newsletters ────────────────────────────────────────────
  state.currentPhase = "newsletters";

  let newsletterCount = 0;
  try {
    const rawChannels = await rateLimiter.run(() =>
      getWahaChannels({ cfg: opts.config, accountId: opts.accountId })
        .catch((err: unknown) => { console.warn(`[waha] sync: getWahaChannels failed: ${String(err)}`); return []; })
    );
    const channelsArr = toArr(rawChannels);
    const newsletterEntries = channelsArr
      .map((c) => {
        const rec = c as Record<string, unknown>;
        const jid = String(rec.id ?? "");
        if (!jid || !jid.endsWith("@newsletter")) return null;
        const name = (rec.name as string) || (rec.subject as string) || (rec.title as string) || undefined;
        return { jid, name, isGroup: false };
      })
      .filter((e): e is { jid: string; name?: string; isGroup: boolean } => e !== null);

    if (newsletterEntries.length > 0) {
      db.bulkUpsertContacts(newsletterEntries);
      newsletterCount = newsletterEntries.length;
    }
  } catch (newsletterErr) {
    console.warn(`[waha] sync: newsletter sync failed: ${String(newsletterErr)}`);
  }

  if (opts.abortSignal.aborted) return mappedContacts.length + mappedGroups.length + newsletterCount;

  // ── Phase 3: Name resolution ────────────────────────────────────────
  // Second pass: resolve names for contacts/newsletters that still have no display_name
  state.currentPhase = "names";

  let namesResolved = 0;
  try {
    // Resolve nameless contacts via WAHA contacts API
    const allContacts = db.getContacts({ limit: 5000, type: "contact" });
    const namelessContacts = allContacts.filter((c) => !c.displayName && !c.jid.endsWith("@lid"));
    const BATCH_SIZE = 5;
    for (let i = 0; i < namelessContacts.length; i += BATCH_SIZE) {
      const batch = namelessContacts.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((c) =>
          rateLimiter.run(() =>
            getWahaContact({ cfg: opts.config, contactId: c.jid, accountId: opts.accountId })
              .then((result) => ({ jid: c.jid, result: result as Record<string, unknown> }))
          )
        ),
      );
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { jid, result } = r.value;
        const resolvedName =
          (result.name as string) || (result.pushName as string) || (result.pushname as string) || undefined;
        if (resolvedName) {
          db.upsertContact(jid, resolvedName, false);
          namesResolved++;
        }
      }
      // Delay between batches for proper rate limiting
      if (i + BATCH_SIZE < namelessContacts.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (opts.abortSignal.aborted) break;
      }
    }

    // Resolve nameless newsletters via WAHA channels API
    const allNewsletters = db.getContacts({ limit: 5000, type: "newsletter" });
    const namelessNewsletters = allNewsletters.filter((c) => !c.displayName);
    for (let i = 0; i < namelessNewsletters.length; i += BATCH_SIZE) {
      const batch = namelessNewsletters.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((c) =>
          rateLimiter.run(() =>
            getWahaNewsletter({ cfg: opts.config, newsletterId: c.jid, accountId: opts.accountId })
              .then((result) => ({ jid: c.jid, result }))
          )
        ),
      );
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { jid, result } = r.value;
        if (!result) continue;
        const resolvedName =
          ((result as Record<string, unknown>).name as string) ||
          ((result as Record<string, unknown>).subject as string) ||
          ((result as Record<string, unknown>).title as string) ||
          undefined;
        if (resolvedName) {
          db.upsertContact(jid, resolvedName, false);
          namesResolved++;
        }
      }
      if (i + BATCH_SIZE < namelessNewsletters.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (opts.abortSignal.aborted) break;
      }
    }
  } catch (err) {
    console.warn(`[waha] sync: per-contact name resolution partially failed: ${String(err)}`);
  }

  // TTL-03: Remove expired JIDs from config file allowFrom BEFORE cleanup.
  // This is the critical enforcement step — inbound.ts reads from config, not SQLite.
  // Without this, expired entries remain in allowFrom and messages continue to pass.
  // DO NOT REMOVE — this is what makes TTL actually block expired contacts.
  try {
    const expiredJids = db.getExpiredJids();
    const configRemoved = await syncExpiredToConfig(expiredJids);
    if (configRemoved < 0) {
      state.lastError = "TTL config sync failed";
    } else if (configRemoved > 0) {
      console.log(`[waha] sync: removed ${configRemoved} expired JIDs from config allowFrom`);
    }
  } catch (err) {
    console.warn(`[waha] sync: syncExpiredToConfig failed: ${String(err)}`);
  }

  // TTL-02: Cleanup allow_list entries expired > 24h ago (keeps recently expired for admin visual feedback)
  // DO NOT REMOVE — prevents unbounded growth of expired rows in allow_list table.
  try {
    const cleaned = db.cleanupExpiredAllowList();
    if (cleaned > 0) {
      console.log(`[waha] sync: cleaned ${cleaned} expired allow_list entries`);
    }
  } catch (err) {
    console.warn(`[waha] sync: cleanupExpiredAllowList failed: ${String(err)}`);
  }

  console.log(
    `[waha] sync: cycle complete for ${opts.accountId} — ` +
    `${mappedContacts.length} contacts, ${mappedGroups.length} groups, ` +
    `${newsletterCount} newsletters, ${namesResolved} names resolved, ` +
    `${lidsMerged} LIDs merged, ${lidToCus.size} LIDs from bulk API (${imported} upserted)`
  );

  return mappedContacts.length + mappedGroups.length + newsletterCount + namesResolved;
}
