# Phase 54: Send Pipeline Enforcement - Research

**Researched:** 2026-03-26
**Domain:** TypeScript send pipeline wiring — mimicry gate integration, jitter delays, typing simulation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Gate Enforcement Point:**
- Single chokepoint wrapper (`enforceMimicry()`) called before every outbound WAHA API send — not per-function checks
- Only "new content" actions count against cap: send, poll, location, vcard, forward, status posts are EXEMPT, edit/delete/pin/unpin are EXEMPT
- Blocked sends return structured error to caller so LLM sees "outside send window" — no silent drops
- Typing indicator sent AFTER gate check passes — only show typing if message will actually send

**Jitter & Timing Strategy:**
- Base delay between consecutive sends: 5 seconds with +/-40% jitter (3-7s effective range) — covers BEH-03 requirement
- Typing indicator duration: message.length / 4 chars-per-second, capped at 8s — ~50 WPM simulation (BEH-02)
- Jitter applies to BOTH agent replies (deliverWahaReply) AND gateway actions — consistent behavior
- Delay + typing implemented in the chokepoint (`enforceMimicry()`) as part of gate check

**Bypass & Edge Cases:**
- Bypass commands: `/shutup`, `/join`, `/leave` + any action with `bypassPolicy=true` (matches Phase 53 INFRA-04)
- Status/story posts do NOT count against hourly cap (different audience, separate concern)
- Batch behavior: all-or-nothing — pre-check batch size vs remaining cap, reject entire batch if would exceed
- Record send count AFTER WAHA API success only — failed calls don't consume cap quota

### Claude's Discretion
- Internal implementation of the chokepoint (function signature, error format, where exactly to hook in)
- Naming conventions for new types/interfaces
- Test structure and coverage approach

### Deferred Ideas (OUT OF SCOPE)
- Persistent message queue for "queue" mode (hold until window opens) — currently reject-only is safer
- Per-contact rateLimitExempt flag — deferred to EXEMPT-01
- Send-time distribution analytics — deferred to DIST-01
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BEH-01 | Jittered inter-message delays on all outbound sends (random variance +/-30-50% of base delay) | `enforceMimicry()` adds jitter delay before returning; base 5s ± 40% = 3-7s range |
| BEH-02 | Typing indicator duration proportional to message length (~40-60 WPM simulation) | `message.length / 4` chars-per-second, capped 8s; `sendWahaPresence()` already works |
| BEH-03 | Drain rate throttling: 3-8s jittered delay between consecutive queue drain sends | Same jitter mechanism as BEH-01; CONTEXT locked to 5s ± 40% |
</phase_requirements>

---

## Summary

Phase 54 wires the fully-tested `mimicry-gate.ts` primitives from Phase 53 into all live outbound send paths. The core work is: (1) implement `enforceMimicry()` in `mimicry-gate.ts` as a single chokepoint that runs gate check + cap check + jitter delay + typing indicator, and (2) call it from the three primary integration points: `sendWahaText()`, `sendWahaImage/Video/File()`, and `deliverWahaReply()` in inbound.ts.

Phase 53 is 100% verified (16/16 tests passing, 644 test suite green). The enforcement primitives `checkTimeOfDay()`, `checkAndConsumeCap()`, `getCapStatus()`, `resolveGateConfig()`, `resolveCapLimit()`, and `MimicryDb` all exist and are tested. Phase 54 is purely a wiring phase — no new data structures needed.

The key architectural discipline is to record the send in the cap DB AFTER the WAHA API call succeeds, not before. This means `checkAndConsumeCap()` should be split into two operations at the chokepoint level: check-only before the call (using the existing `countRecentSends` + `resolveCapLimit` directly or a new read-only pre-check), and `recordSend()` after success. Alternatively the simpler approach is to call `checkAndConsumeCap()` optimistically (it records) and rely on the existing behavior — but this contradicts the CONTEXT decision "record send count AFTER WAHA API success only." This is the one implementation decision requiring care.

**Primary recommendation:** Add `enforceMimicryPre()` (gate + cap pre-check, no recording) and `recordMimicryPost()` (record after success) as two separate exported functions alongside the existing `checkAndConsumeCap()`, OR use the existing `getCapStatus()` for the pre-check and call `db.recordSend()` directly after success. The second option reuses existing public API.

---

## Standard Stack

### Core (all already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | existing | Cap counter persistence via MimicryDb | Already used in mimicry-gate.ts via createRequire |
| vitest | existing | Unit tests for enforceMimicry | All 644 tests pass; same framework as Phase 53 |
| TypeScript | existing | Chokepoint typing | Same as rest of codebase |

No new libraries needed. This phase is pure wiring.

**Installation:** None required.

---

## Architecture Patterns

### Recommended Project Structure

No new files needed beyond one addition to `mimicry-gate.ts`. The chokepoint `enforceMimicry()` and helpers live there.

New test file: `src/send-pipeline.test.ts` — integration-style tests for the enforcement wiring.

### Pattern 1: Existing Guard Pattern (Follow This)

`assertCanSend()` and `assertPolicyCanSend()` show the established guard pattern: called at the top of send functions, throw on violation. `enforceMimicry()` follows this same pattern but is async (needs `await` for timing delays).

```typescript
// Existing pattern in sendWahaText (send.ts:216-226)
const client = getClient(params.cfg, params.accountId);
assertCanSend(client.session, params.cfg);
const chatId = normalizeWahaMessagingTarget(params.to);
if (!params.bypassPolicy) {
  assertPolicyCanSend(chatId, params.cfg);
}
// Phase 54: add here: await enforceMimicry(client.session, chatId, params.cfg, { bypassPolicy: params.bypassPolicy })
```

### Pattern 2: enforceMimicry() Chokepoint

```typescript
// Source: mimicry-gate.ts (new export, Phase 54)
export async function enforceMimicry(
  session: string,
  chatId: string,
  cfg: CoreConfig,
  opts: { bypassPolicy?: boolean; messageLength?: number; count?: number }
): Promise<void> {
  // 1. bypassPolicy skips everything (INFRA-04)
  if (opts.bypassPolicy) return;

  // 2. Resolve per-target overrides from DirectoryDb (dm_settings)
  const db = getMimicryDb();
  const dirDb = getDirectoryDb(/* accountId from session */);
  const targetOverrideGate = dirDb.getDmSettings(chatId)?.sendGateOverride ?? null;
  const targetOverrideCap = dirDb.getDmSettings(chatId)?.hourlyCapOverride ?? null;

  // 3. Time gate check
  const gateConfig = resolveGateConfig(session, cfg.channels?.waha ?? {}, targetOverrideGate);
  const gateResult = checkTimeOfDay(gateConfig);
  if (!gateResult.allowed) {
    throw new Error(`[mimicry] Send blocked: ${gateResult.reason}`);
  }

  // 4. Cap pre-check (read-only, no recording yet)
  const firstSendAt = db.getFirstSendAt(session);
  const maturity = getMaturityPhase(firstSendAt);
  const limit = resolveCapLimit(session, maturity, cfg.channels?.waha ?? {}, targetOverrideCap);
  const count = db.countRecentSends(session) + (opts.count ?? 0);
  if (count >= limit) {
    throw new Error(`[mimicry] Send blocked: Hourly cap reached (${count}/${limit})`);
  }

  // 5. Jitter delay (BEH-01, BEH-03): base 5000ms ± 40%
  const baseDelay = 5000;
  const jitter = baseDelay * 0.4;
  const delay = baseDelay + (Math.random() * 2 - 1) * jitter; // 3000-7000ms
  await sleep(delay);

  // 6. Typing indicator AFTER gate passes (BEH-02)
  const typingMs = Math.min((opts.messageLength ?? 0) / 4 * 1000, 8000);
  if (typingMs > 0) {
    await sendWahaPresence({ cfg, chatId, typing: true, accountId: session }).catch(...);
    await sleep(typingMs);
    await sendWahaPresence({ cfg, chatId, typing: false, accountId: session }).catch(...);
  }
  // Recording happens AFTER WAHA API call in the caller (not here)
}

// Companion: call after successful WAHA API response
export function recordMimicrySuccess(session: string): void {
  getMimicryDb().recordSend(session);
}
```

**Key note:** The CONTEXT decision "record send count AFTER WAHA API success only" means `enforceMimicry()` must NOT call `recordSend()`. A separate `recordMimicrySuccess(session)` call wraps the existing `db.recordSend()` and is called in the send function's try/finally or success path.

### Pattern 3: Send Function Integration

For `sendWahaText`, `sendWahaImage`, `sendWahaVideo`, `sendWahaFile`:

```typescript
// After assertCanSend + assertPolicyCanSend, before API call:
if (!params.bypassPolicy) {
  await enforceMimicry(client.session, chatId, params.cfg, {
    messageLength: typeof params.text === "string" ? params.text.length : 0,
  });
}
// ... WAHA API call ...
if (!params.bypassPolicy) {
  recordMimicrySuccess(client.session);
}
```

For `deliverWahaReply()` in inbound.ts — the existing code already sends typing via `presenceCtrl` and stops it before sending. The `enforceMimicry()` call replaces or wraps the existing typing initiation:

```typescript
// deliverWahaReply: before text/media send
await enforceMimicry(accountId, chatId, cfg, {
  messageLength: text.length,
  // bypassPolicy not applicable here — deliverWahaReply is always agent reply
});
recordMimicrySuccess(accountId);
```

**Caution:** `deliverWahaReply()` currently uses `presenceCtrl?.finishTyping()` from the inbound pipeline's `startHumanPresence()`. The mimicry typing simulation in `enforceMimicry()` is distinct — it's a pre-send simulation, not the "thinking" indicator. The existing presenceCtrl typing (started during LLM reasoning) must be stopped BEFORE `enforceMimicry()` fires its own typing, otherwise two competing typing states exist.

### Pattern 4: Batch Pre-Check

For `sendWahaMediaBatch()` which calls `sendWahaMedia()` internally — the CONTEXT specifies all-or-nothing: pre-check batch size vs remaining cap, reject entire batch if would exceed. Add a `count` parameter to `enforceMimicry()` opts for batch pre-check:

```typescript
// In sendWahaMediaBatch, before the loop:
await enforceMimicry(session, chatId, cfg, { count: mediaUrls.length });
// Then loop without re-checking per item
```

### Anti-Patterns to Avoid

- **Recording before API call:** The CONTEXT is explicit — record AFTER success. `checkAndConsumeCap()` as written in Phase 53 records immediately. Do NOT call it directly from the chokepoint.
- **Per-function gate checks:** CONTEXT says single chokepoint, not scattered checks in each send function.
- **Competing typing indicators:** `deliverWahaReply()` already manages typing via `presenceCtrl`. Stop presenceCtrl typing before `enforceMimicry()` fires its typing simulation.
- **Bypassing on ALL status sends:** Status/story sends (`sendWahaTextStatus`, etc.) are not subject to cap but the time gate still applies per CONTEXT ("status posts do NOT count against hourly cap" — cap exempt, gate still enforced unless bypassPolicy is set).
- **Adding bypassPolicy to sendWahaPoll/Location/Vcard:** CONTEXT says these count as "new content" — they DO check the cap. Only edit/delete/pin/unpin are cap-exempt.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Jitter delay | Custom random delay | `Math.random() * 2 - 1) * jitter + base` pattern | Trivial, no library needed |
| Typing indicator | Custom typing API call | `sendWahaPresence()` in send.ts:176 | Already verified working |
| Cap counting | New counter | `getMimicryDb()` + `countRecentSends()` from mimicry-gate.ts | Fully tested Phase 53 |
| Config resolution | New merge logic | `resolveGateConfig()` + `resolveCapLimit()` from mimicry-gate.ts | Fully tested Phase 53 |
| Per-target overrides | New DB lookup | `dm_settings.send_gate_json` + `dm_settings.hourly_cap_json` in directory.ts | Wired in Phase 53 (lines 663-664) |

---

## Runtime State Inventory

Not applicable — this is a wiring phase, not a rename/refactor. No stored state changes.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies beyond project's own code).

---

## Common Pitfalls

### Pitfall 1: Circular Import — send.ts imports mimicry-gate.ts which must not import send.ts

**What goes wrong:** `enforceMimicry()` needs `sendWahaPresence()` for typing indicators. If `mimicry-gate.ts` imports `send.ts`, and `send.ts` imports `mimicry-gate.ts`, Node.js ESM circular import resolution can produce `undefined` exports at startup.

**Why it happens:** TypeScript/ESM resolves circular imports at module evaluation time. If `send.ts` is evaluated first and imports `mimicry-gate.ts` which in turn imports `send.ts`, the first `send.ts` exports may be undefined at the point `mimicry-gate.ts` tries to use them.

**How to avoid:** Two options:
1. Keep `enforceMimicry()` in `mimicry-gate.ts` but pass `sendWahaPresence` as a parameter (dependency injection):
   ```typescript
   export async function enforceMimicry(
     ...,
     deps: { sendPresence: (params: {...}) => Promise<void> }
   )
   ```
2. Move `enforceMimicry()` to a new thin file `src/mimicry-enforcer.ts` that imports from both `mimicry-gate.ts` and `send.ts` — no circular dependency.

**Warning signs:** Build succeeds but `sendWahaPresence` is `undefined` at runtime, causing TypeError.

**Recommendation:** Option 2 (new file `src/mimicry-enforcer.ts`) is cleaner and avoids parameter pollution. The chokepoint file imports from `mimicry-gate.ts` and `send.ts` with no circular dependency.

### Pitfall 2: Double Typing Indicator in deliverWahaReply

**What goes wrong:** `deliverWahaReply()` already manages typing via `presenceCtrl.finishTyping()` (called before send). If `enforceMimicry()` also fires a typing indicator inside, the sequence becomes: start presenceCtrl typing → LLM thinks → enforceMimicry fires typing again → stop → send. The second typing start may overlap or confuse the receiver.

**Why it happens:** The existing `presenceCtrl` typing in `inbound.ts` is the "thinking" indicator started when the message arrives. `enforceMimicry()` typing is the "composing reply" simulation. Different purposes but same WAHA API.

**How to avoid:** In `deliverWahaReply()`, stop `presenceCtrl` BEFORE calling `enforceMimicry()`. The `enforceMimicry()` typing then takes over for the mimicry simulation. `presenceCtrl.finishTyping()` already exists at line 160.

**Warning signs:** Typing indicator on/off/on/off visible to recipient.

### Pitfall 3: cap recorded on WAHA API 4xx/5xx

**What goes wrong:** If `recordMimicrySuccess()` is placed unconditionally after the WAHA API call (not inside the success path), failed sends consume cap quota.

**Why it happens:** WAHA `callWahaApi()` throws on non-2xx responses. `recordMimicrySuccess()` must be placed where it only executes if the call resolved without throwing.

**How to avoid:** Call `recordMimicrySuccess()` only after the awaited API call — if the call throws, execution doesn't reach `recordMimicrySuccess()`. Standard try/finally won't work — must be in the success path only, not finally.

**Warning signs:** Cap counter incrementing on API errors.

### Pitfall 4: sendWahaImage/Video/File missing bypassPolicy param (noted in mimicry-gate.ts line 4-6)

**What goes wrong:** `/shutup`, `/join`, `/leave` commands call `sendWahaText()` with `bypassPolicy: true`. If they also trigger media sends (unlikely but possible), those lack the bypass param and will hit the gate check.

**Why it happens:** Only `sendWahaText()` has `bypassPolicy` today. `sendWahaImage`, `sendWahaVideo`, `sendWahaFile` do not.

**How to avoid:** Add `bypassPolicy?: boolean` param to all three functions as the Phase 53 note at line 4-6 instructs. This is explicitly called out in `mimicry-gate.ts` as a TODO for Phase 54.

### Pitfall 5: Jitter delay blocking inbound event loop

**What goes wrong:** If `enforceMimicry()` is called in the hot path of `handleWahaInbound`, the 3-7 second sleep blocks that message's processing chain. Subsequent inbound events for the same session are also delayed if the gateway processes them serially.

**Why it happens:** The gateway dispatches agent replies synchronously in the inbound pipeline. Sleeping in `deliverWahaReply()` means the entire inbound handler for that message hangs for 3-7 seconds.

**How to avoid:** This is acceptable behavior — the gateway awaits the reply delivery. The delay is intentional (mimicry). However, verify the gateway doesn't have a short timeout on reply delivery that would cause false errors.

**Warning signs:** Gateway logs showing "reply timeout" or similar within 3-7 seconds.

---

## Code Examples

Verified patterns from codebase inspection:

### sendWahaPresence (send.ts:176-189)
```typescript
// Source: send.ts:176-189
export async function sendWahaPresence(params: {
  cfg: CoreConfig;
  chatId: string;
  typing: boolean;
  accountId?: string;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  return client.post(params.typing ? "/api/startTyping" : "/api/stopTyping", {
    chatId: params.chatId,
    session: client.session,
  });
}
```

### Existing guard pattern in sendWahaText (send.ts:216-226)
```typescript
// Source: send.ts:207-226
export async function sendWahaText(params: {
  cfg: CoreConfig; to: string; text: string;
  replyToId?: string; accountId?: string;
  botProxy?: boolean;
  bypassPolicy?: boolean;
}) {
  const client = getClient(params.cfg, params.accountId);
  assertCanSend(client.session, params.cfg);
  const chatId = normalizeWahaMessagingTarget(params.to);
  if (!chatId) throw new Error("WAHA sendText requires chatId");
  if (!params.bypassPolicy) {
    assertPolicyCanSend(chatId, params.cfg);
  }
  // ... mute check ...
  // Phase 54 hook: await enforceMimicry(client.session, chatId, params.cfg, {...})
  // ... API call ...
  // Phase 54 hook: recordMimicrySuccess(client.session)
}
```

### MimicryDb API (mimicry-gate.ts)
```typescript
// Available after Phase 53:
getMimicryDb().countRecentSends(session)      // rolling 60-min count
getMimicryDb().recordSend(session)             // record one send
getMimicryDb().getFirstSendAt(session)         // for maturity calc
getMaturityPhase(firstSendAt)                  // "new" | "warming" | "stable"
resolveGateConfig(session, cfg, targetOverride) // ResolvedGateConfig
resolveCapLimit(session, maturity, cfg, override) // number (limit)
checkTimeOfDay(config)                         // GateResult {allowed, reason?}
```

### DirectoryDb per-target overrides (directory.ts:663-664)
```typescript
// send_gate_json and hourly_cap_json stored in dm_settings
// Read via dirDb.getDmSettings(chatId) — returns object with sendGateOverride / hourlyCapOverride
// Migration at directory.ts:273-276 ensures columns exist
```

### deliverWahaReply call sites (inbound.ts:145-198)
```typescript
// deliverWahaReply is called from handleWahaInbound
// Key sequence:
//   1. presenceCtrl started earlier in inbound pipeline (startHumanPresence)
//   2. deliverWahaReply stops typing (line 160), then sends
// Phase 54: stop presenceCtrl FIRST, then call enforceMimicry (which fires its own typing)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No send rate limiting | Phase 53 rolling-window cap | 2026-03-26 | Phase 54 wires it to live sends |
| No time gates | Phase 53 time-of-day gate | 2026-03-26 | Phase 54 wires it to live sends |
| No typing simulation | sendWahaPresence exists | Phase 7 (2026-03-15) | Phase 54 uses it in enforceMimicry |
| Manual per-function policy checks | assertCanSend + assertPolicyCanSend | Phase 4/6 | enforceMimicry follows same guard pattern |

---

## Open Questions

1. **Where exactly does `enforceMimicry()` live to avoid circular imports?**
   - What we know: `send.ts` imports `mimicry-gate.ts` is fine; `mimicry-gate.ts` importing `send.ts` creates a cycle
   - What's unclear: Whether the circular import would actually break (Node.js sometimes resolves these)
   - Recommendation: New file `src/mimicry-enforcer.ts` is safest. Avoids the question entirely.

2. **Does `deliverWahaReply()` need bypassPolicy plumbing?**
   - What we know: `deliverWahaReply()` is only called for agent replies — never for `/shutup` confirmations (those use `sendWahaText` with bypassPolicy)
   - What's unclear: Are there any paths where `deliverWahaReply` should bypass (e.g., pairing challenge auto-replies)?
   - Recommendation: No bypass needed for `deliverWahaReply` — it's always "agent content" subject to gate+cap.

3. **How does getDirectoryDb work with session vs accountId?**
   - What we know: `getDirectoryDb(accountId)` — `enforceMimicry` receives `session` string, needs `accountId`
   - What's unclear: Are session and accountId always the same? Looking at send.ts:232-234, `dirDb = getDirectoryDb(client.accountId)` — client has both.
   - Recommendation: Pass `accountId` (not `session`) to `enforceMimicry()`, same as existing guard pattern. Or get accountId from `client.accountId` before calling `enforceMimicry`.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run src/send-pipeline.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BEH-01 | Jitter delay applied on send (verify delay range 3000-7000ms) | unit (mock sleep) | `npx vitest run src/send-pipeline.test.ts` | No — Wave 0 |
| BEH-02 | Typing indicator duration = messageLength/4 capped 8s | unit (mock sendWahaPresence) | `npx vitest run src/send-pipeline.test.ts` | No — Wave 0 |
| BEH-03 | Consecutive sends each get jitter delay | unit (mock sleep, 2 sends) | `npx vitest run src/send-pipeline.test.ts` | No — Wave 0 |
| BEH-01+02+03 | bypassPolicy=true skips gate, cap, jitter | unit | `npx vitest run src/send-pipeline.test.ts` | No — Wave 0 |
| BEH-01+02 | Blocked send (time gate) throws structured error | unit | `npx vitest run src/send-pipeline.test.ts` | No — Wave 0 |
| BEH-01+02 | Blocked send (cap exceeded) throws structured error | unit | `npx vitest run src/send-pipeline.test.ts` | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/send-pipeline.test.ts src/mimicry-gate.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/send-pipeline.test.ts` — covers BEH-01, BEH-02, BEH-03 enforcement wiring
- [ ] `src/mimicry-enforcer.ts` — new chokepoint file (if circular import avoidance approach chosen)

*(Existing `src/mimicry-gate.test.ts` covers Phase 53 primitives — those stay untouched)*

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 54 |
|-----------|-------------------|
| DO NOT CHANGE markers in send.ts | Read all existing comments before modifying sendWahaText, sendWahaImage/Video/File, sendWahaPresence |
| Make backups before changes | `cp src/send.ts src/send.ts.bak.v1.20-pre54-01` before modifying |
| bypassPolicy pattern must be preserved | `/shutup`, `/join`, `/leave` must not hit gate or cap — bypassPolicy param addition to sendWahaImage/Video/File is required |
| ALWAYS clear /tmp/jiti/ after deploy | Critical for testing on hpg6 |
| Record send AFTER API success | Contradicts `checkAndConsumeCap()` which records immediately — need `recordMimicrySuccess()` separate function |
| Config resolution: global -> session -> target | Already handled by Phase 53 primitives |
| All new Zod fields use .optional().default() | No new Zod fields in Phase 54 — config schema unchanged |
| No new library dependencies | Phase 54 uses only existing libraries |

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `src/mimicry-gate.ts` (Phase 53 output, 316 lines, all exports verified)
- Direct code inspection: `src/send.ts` (lines 176-486, guard patterns, bypassPolicy usage)
- Direct code inspection: `src/inbound.ts` (lines 145-198, deliverWahaReply)
- `53-VERIFICATION.md` — 16/16 truths verified, Phase 53 complete

### Secondary (MEDIUM confidence)
- CONTEXT.md — user decisions locked and specific
- REQUIREMENTS.md — BEH-01, BEH-02, BEH-03 requirements confirmed

### Tertiary (LOW confidence)
- Circular import behavior in Node.js ESM — documented behavior but not tested in this specific project topology

---

## Metadata

**Confidence breakdown:**
- Integration points: HIGH — all call sites identified by direct inspection
- Guard pattern: HIGH — assertCanSend/assertPolicyCanSend patterns are established and stable
- Circular import risk: MEDIUM — known issue with documented mitigation; new file approach eliminates it
- Test approach: HIGH — vitest framework established, same pattern as mimicry-gate.test.ts

**Research date:** 2026-03-26
**Valid until:** 2026-04-25 (stable codebase, no fast-moving dependencies)
