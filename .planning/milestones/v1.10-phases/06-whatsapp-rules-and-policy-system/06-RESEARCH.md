# Phase 6: WhatsApp Rules and Policy System - Research

**Researched:** 2026-03-14
**Domain:** File-based hierarchical policy system with lazy loading, YAML parsing, identity normalization, merge engine, authorization, and model payload injection — all within an existing TypeScript OpenClaw plugin
**Confidence:** HIGH (all design documents provided, codebase fully read, integration points verified)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Rules Hierarchy**
- Global contact default + optional specific contact override
- Global group default + optional specific group override
- Optional current-speaker contact rules when needed by group policy
- Merge precedence: system defaults -> global scope -> specific override -> runtime constraints -> owner explicit override
- Scalars: higher layer replaces lower. Arrays: replace (not append). Objects: deep merge by key. Missing fields = inherit.

**Lazy Loading (HARD REQUIREMENT)**
- Rules load ONLY after message passes WAHA/OpenClaw hard filter (inbound) or before a specific outbound send
- NEVER load all rules at gateway startup
- NEVER pre-load all participant files for a group — only current speaker when needed
- Event-driven loading, not startup-driven

**DM Behavior**
- Resolve target contact stable identity
- Load global contact defaults -> specific contact override if present -> merge -> inject compact resolved payload

**Group Behavior**
- Resolve target group identity + current speaker identity
- Load global group defaults -> specific group override -> merge
- Evaluate contact_rule_mode: apply/ignore/restricted
- Evaluate participants_allowlist.mode: everyone/none/explicit/admins
- Handle unknown participants via unknown_participant_policy: fallback_to_global_contact/deny/observe_only
- Load current speaker contact policy ONLY when needed

**File Layout (YAML)**
- Rules stored under a dedicated path (e.g., rules/contacts/_default.yaml, rules/groups/_default.yaml)
- Specific overrides: rules/contacts/<safe-name>__<id>.yaml, rules/groups/<safe-name>__<id>.yaml
- _default.yaml mandatory for both contacts and groups
- Specific files are sparse partial overrides, NOT full copies

**Identity Normalization**
- Stable IDs: @c:... (phone JID), @lid:... (LID), @g:... (group)
- Use stable IDs for enforcement, never display names alone
- Normalize JID/LID for consistent policy resolution

**Manager Authorization**
- Owner (super-admin) = only one who can appoint/revoke managers
- Global managers can edit lower-scope policy but NOT appoint/revoke
- Contact managers edit only that contact scope
- Group managers edit only that group scope
- Non-managers cannot change policy
- Authorization is code-enforced, not prompt-only

**Compact Resolved Payload**
- Never inject raw rule files into model context
- Resolve/merge in plugin code -> inject compact effective policy per event
- DM payload: chat_type, target_id, can_initiate, can_reply, privacy_level, tone, language, forbidden_actions, manager_edit_allowed
- Group payload: + speaker_id, participation_mode, proactive_allowed, contact_rule_mode, participants_allowlist_mode, speaker_allowed, unknown_participant_policy, forbidden_topics

**Caching Strategy**
- Short TTL in-memory cache keyed by scope ID + file modification time
- Invalidate on file update or policy edit
- Cache resolved policy blobs, not full directory loads
- No preloading

**Error Handling**
- Missing global default: fail closed for editing, use hardcoded safe defaults for messages, log loudly
- Malformed override: ignore override, fall back to global default, log validation error
- Unresolvable identity: use safest available normalized ID, never grant extra permissions
- Missing manager data: treat as no managers except owner

**Security Posture**
- Never use display name alone for authorization
- Never let non-owner appoint/revoke managers
- Never assume unknown participant == trusted
- Never bypass policy load for proactive sends
- Never depend on model memory for rules

### Claude's Discretion
- Internal module organization (suggested: rules-loader, rules-merge, rules-resolver, policy-enforcer, manager-authorizer, policy-cache, resolved-payload-builder, identity-resolver)
- Exact file storage path for rules (workspace vs plugin directory)
- YAML parsing library choice
- Cache TTL values
- Hook integration points in existing inbound.ts/send.ts code
- Admin panel UI for rules management (if included)
- Whether to add admin API endpoints for CRUD operations on rules
- Test strategy and test file organization

### Deferred Ideas (OUT OF SCOPE)
- UI-based rules editor in admin panel (file-based for v1, UI later)
- Role buckets like admins, vip, owner_only for participants_allowlist (v2)
- Appendable array fields in merge (v2 — replace-only for v1)
- null as explicit value in overrides (document if supported later)
- Media URL expiration handling in context of rules
- Group participant join/leave event hooks
- Anti-spam moderator features (separate sammie-anti-spam-moderator design exists)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

Phase 6 is a new phase. Requirements are derived from the design documents (claude-code-handoff.md, resolver-algorithm.md, whatsapp-rules-loading-design.md, whatsapp-rules-schema.yaml) and the CONTEXT.md locked decisions. Formal REQ-IDs are assigned here for planner use:

| ID | Description | Research Support |
|----|-------------|-----------------|
| RULES-01 | YAML file loader for _default.yaml and sparse override files with safe parse | yaml package + Node fs/promises, zod validation |
| RULES-02 | Identity normalizer: JID/LID -> @c:..., @lid:..., @g:... stable IDs | Extends existing normalize.ts patterns |
| RULES-03 | Merge engine: 5-layer scalar/object/array merge with sparse inheritance | Pure TypeScript, no library needed |
| RULES-04 | Inbound DM policy resolver: load + merge + return compact payload | Hook after existing hard filter in handleWahaInbound |
| RULES-05 | Inbound group policy resolver: load group + optional speaker contact + allowlist gate | Hook after existing group filter in handleWahaInbound |
| RULES-06 | Outbound policy enforcer: assertCanSend-style check before send operations | Hook in assertCanSend or wrapper in send.ts |
| RULES-07 | Policy-keyed cache: scope ID + mtime, short TTL, invalidate on edit | LRUCache from lru-cache (already a dependency) |
| RULES-08 | Manager authorization flow: actor identity -> scope -> auth matrix -> allow/deny | New manager-authorizer.ts module |
| RULES-09 | Compact resolved-payload builder: DM and group serializers | New resolved-payload-builder.ts module |
| RULES-10 | ctxPayload injection: attach resolved policy to inbound context before model turn | Extend ctxPayload object in handleWahaInbound |
| RULES-11 | Policy edit command path: DM/group command triggers authorized field update + file write | New action handler or inline in handleAction |
| RULES-12 | Seed _default.yaml files: contacts/_default.yaml and groups/_default.yaml with schema defaults | Wave 0 task: create initial YAML files at configured path |
| RULES-13 | Unit tests for merge engine, identity normalizer, payload builder, auth matrix | tests/ directory, vitest |
| RULES-14 | Integration tests for DM resolution, group resolution, unknown participant, outbound enforcement | tests/ directory, vitest with file system mocking |
</phase_requirements>

---

## Summary

Phase 6 adds a lazy-loaded WhatsApp rules and policy system to the waha-oc plugin. The design is fully specified across four source documents. This is not exploratory architecture work — the resolver algorithm, schema, loading design, and security posture are all locked. The implementation task is translating those specs into TypeScript modules that integrate cleanly with the existing codebase.

The codebase has well-established patterns to follow: pure-function modules extracted for testability (see trigger-word.ts, mentions.ts, dedup.ts), LRUCache already a dependency (lru-cache npm package), zod already a dependency for schema validation, vitest test infrastructure in tests/ directory. The hook insertion point is clearly identified: inbound policy resolution goes AFTER the existing hard filter and group filter in handleWahaInbound (lines 364+), and outbound enforcement extends the assertCanSend pattern in send.ts.

The most novel complexity in this phase is the merge engine (5-layer sparse inheritance) and the authorization matrix. Both are pure computation with no external dependencies. YAML parsing requires adding one new dependency (the yaml npm package — no YAML parser is currently installed). The existing LRUCache (already used for resolveTarget) covers the caching requirement.

**Primary recommendation:** Implement as 8 new source modules following existing testability conventions, with a single inbound hook inserted after line 364 of inbound.ts and an outbound hook wrapping assertCanSend. Keep the file storage path configurable but default to ~/.openclaw/workspace/skills/waha-openclaw-channel/rules/ so rules survive reinstalls.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| yaml | ^2.x | Parse YAML rule files safely | Only production-quality YAML parser for Node.js ESM; supports parse options, safe by default, 0 deps |
| lru-cache | ^11.2.6 (already installed) | Policy blob cache keyed by scope ID + mtime | Already a project dependency, used for resolveTarget cache |
| zod | ^4.3.6 (already installed) | Runtime schema validation of parsed YAML | Already a project dependency, used in config-schema.ts |
| better-sqlite3 | ^11.10.0 (already installed) | SQLite for directory — NOT needed for rules | Rules are file-based YAML, not SQLite |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:fs/promises | built-in | Read rule files, check mtime with stat() | All file I/O in rules-loader.ts |
| node:path | built-in | Resolve rule file paths safely | Construct file paths from scope ID |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| yaml package | js-yaml | js-yaml is older, heavier; yaml is modern ESM-first, 0 deps, actively maintained |
| yaml package | JSON rule files | JSON lacks comments, worse UX for hand-editing; design explicitly chose YAML |
| LRUCache | Map with TTL | LRU eviction needed; already have lru-cache — use it |
| zod validation | Manual type guards | Zod already a dep, gives better error messages for malformed overrides |

**Installation:**
```bash
npm install yaml
```
This is the only new dependency. All others already installed.

---

## Architecture Patterns

### Recommended Project Structure (new files)
```
src/
├── rules-loader.ts         # File I/O: load _default.yaml and override files, return parsed objects
├── rules-merge.ts          # Pure merge engine: 5-layer merge, scalar/object/array rules
├── identity-resolver.ts    # JID/LID -> stable @c:/@lid:/@g: IDs, extends normalize.ts
├── rules-resolver.ts       # Orchestrates: load + merge -> resolved contact/group policy
├── policy-cache.ts         # LRUCache wrapper keyed by scope+mtime, short TTL
├── policy-enforcer.ts      # Outbound gate: evaluate resolved policy -> allow/deny
├── manager-authorizer.ts   # Authorization matrix: actor + scope + action -> allow/deny
├── resolved-payload-builder.ts  # Serialize resolved policy to compact DM/group payload
rules/
├── contacts/
│   └── _default.yaml       # REQUIRED: global contact defaults (Wave 0)
└── groups/
    └── _default.yaml       # REQUIRED: global group defaults (Wave 0)
```

The rules/ directory location is Claude's discretion. Recommended: configurable via config, defaulting to a path alongside the plugin's workspace location so rules survive reinstalls.

### Pattern 1: Extract-for-Testability (established project pattern)
**What:** Pure functions extracted to dedicated files, imported and re-exported from integration files
**When to use:** Any logic that has clear inputs/outputs and no openclaw SDK dependencies
**Example:**
```typescript
// rules-merge.ts — pure function, no imports, fully testable
export function mergeRuleLayers(layers: Partial<ContactRule>[]): ContactRule {
  return layers.reduce((acc, layer) => deepMergeRule(acc, layer), {} as ContactRule);
}
// Follows same pattern as trigger-word.ts, mentions.ts, dedup.ts
```

### Pattern 2: LRU Cache with mtime key (extends existing lru-cache usage)
**What:** Cache resolved policy blobs keyed by `${scopeId}:${mtime}` with short TTL
**When to use:** Any file-based rule load — default or override
**Example:**
```typescript
// policy-cache.ts
import { LRUCache } from "lru-cache";
const cache = new LRUCache<string, ResolvedPolicy>({ max: 500, ttl: 30_000 });
export function getCachedPolicy(scopeId: string, mtime: number): ResolvedPolicy | undefined {
  return cache.get(`${scopeId}:${mtime}`);
}
```

### Pattern 3: Inbound Hook — Insert After Existing Hard Filter
**What:** After the message passes all existing filters (lines ~364 in inbound.ts), call the rules resolver and attach compact payload to ctxPayload
**When to use:** All inbound messages that reach the agent
**Example:**
```typescript
// In handleWahaInbound, after line 476 (DM filter) and after line 362 (group filter):
const resolvedPolicy = await resolveInboundPolicy({ isGroup, chatId, senderId, cfg: config });
// Then in ctxPayload construction:
const ctxPayload = core.channel.reply.finalizeInboundContext({
  // ...existing fields...
  WahaResolvedPolicy: resolvedPolicy ? JSON.stringify(resolvedPolicy) : undefined,
});
```

### Pattern 4: Outbound Hook — Wrap assertCanSend
**What:** Before every WAHA send, check resolved policy's outbound constraints in addition to role check
**When to use:** Proactive sends where can_initiate=false or participation_mode=silent_observer
**Example:**
```typescript
// In send.ts or a new policy-enforcer.ts:
export async function assertPolicyCanSend(chatId: string, cfg: CoreConfig): Promise<void> {
  const policy = await resolveOutboundPolicy({ chatId, cfg });
  if (!policy.can_initiate && policy.chat_type === "dm") {
    throw new Error(`Policy blocks initiating DM to ${chatId}: can_initiate=false`);
  }
}
```

### Pattern 5: File Naming — Filesystem-Safe Scope IDs
**What:** Convert scope ID to filesystem-safe filename using safe-name + stable ID
**When to use:** Looking up override files for a specific contact or group
**Example:**
```
Contact: 972544329000@c.us -> omer__@c_972544329000@c.us.yaml
Group: 120363421825201386@g.us -> test-group__@g_120363421825201386@g.us.yaml
```
Implementation: replace `@`, `.`, special chars with `_` for the ID portion; keep safe-name as human label.

### Anti-Patterns to Avoid
- **Loading on startup:** NEVER call loadAllRules() at plugin init — violates the hard requirement
- **Display-name authorization:** NEVER use pushName or display name to resolve policy — only stable JIDs
- **Raw YAML injection:** NEVER pass file contents to ctxPayload — only the resolved compact payload
- **All-participant loads:** NEVER load all contact overrides for a group — only current speaker
- **Monolithic resolver:** NEVER put all resolution logic in inbound.ts — keep modules separate for testability
- **Shared mutable state:** Rules cache is module-level (acceptable), but never make policy objects mutable after construction

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | Custom text parser | yaml npm package | YAML edge cases (multiline strings, anchors, special chars) are non-trivial; safe parse mode prevents code execution |
| Schema validation | Manual type guards | zod (already installed) | zod gives field-level error messages, path tracing, partial validation — critical for "ignore malformed override, log error" requirement |
| LRU cache | Custom Map + TTL | lru-cache (already installed) | Already in project; handles TTL + max-size eviction correctly; LRU behavior matches "most recently used scopes stay warm" |
| File watching | fs.watch() / chokidar | mtime check on read | File watching adds complexity and event loop load; mtime-on-read + cache invalidation is simpler and sufficient for this use case |

**Key insight:** The merge engine and auth matrix are genuinely new logic with no good library substitute. Those MUST be hand-rolled — but everything else (parsing, validation, caching) already has suitable dependencies in the project.

---

## Common Pitfalls

### Pitfall 1: LID vs Phone JID Inconsistency
**What goes wrong:** WhatsApp sends messages with LID senders (@lid) in some cases and @c.us in others (especially NOWEB engine). If identity normalization doesn't handle both and map them to the same stable ID, policy resolution fails silently or applies wrong scope.
**Why it happens:** WAHA NOWEB engine reports group participants as @lid JIDs, not @c.us. This is documented in CLAUDE.md: "groupAllowFrom needs BOTH @c.us AND @lid JIDs (NOWEB sends @lid)".
**How to avoid:** In identity-resolver.ts, always attempt LID<->phone lookup (using existing findWahaPhoneByLid / findWahaLidByPhone from send.ts) and store BOTH as aliases. Policy lookup must match on either.
**Warning signs:** Policy falls through to global default for all group speakers, even those with specific overrides.

### Pitfall 2: ctxPayload Field Name Collision
**What goes wrong:** Adding a WahaResolvedPolicy field to ctxPayload that conflicts with an OpenClaw SDK field causes silent overwrite or type error.
**Why it happens:** The finalizeInboundContext call accepts a wide Record — unknown fields pass through but may not survive if the SDK serializes/filters the context.
**How to avoid:** Use a clearly namespaced field name (e.g., WahaResolvedPolicy or WahaPolicy). Check existing ctxPayload keys in inbound.ts (Body, From, To, SessionKey, Provider, etc.) and avoid those. Test that the payload actually reaches the model turn by logging it.
**Warning signs:** Model receives no policy context despite code running.

### Pitfall 3: Malformed Override Silently Wiping Fields
**What goes wrong:** A partial override file is parsed but zod validation fails partway through — code attempts to merge an incomplete/undefined object and zeroes out lower-layer values.
**Why it happens:** Merge function called with undefined or partially-validated result.
**How to avoid:** In rules-loader.ts, validate override files with zod using `.partial()` schema (all fields optional for overrides). On validation failure, log and return `undefined`. In rules-resolver.ts, skip merge of undefined override (fall back to global default). Never pass validation failure result to merge engine.
**Warning signs:** Contacts with valid overrides get global defaults applied; error log shows "malformed override" but policy still processes.

### Pitfall 4: Outbound Enforcement Missing for Trigger-Word-Routed Replies
**What goes wrong:** When a group trigger-word fires and routes the reply to a DM (resolveTriggerTarget), the reply goes to the sender's personal chat. If that sender has can_initiate=false in their contact policy, the policy should block the proactive DM — but if outbound enforcement only runs on explicit agent-initiated sends, the trigger-word reply bypasses it.
**Why it happens:** deliverWahaReply in inbound.ts calls sendWahaText directly without going through assertPolicyCanSend.
**How to avoid:** Add policy enforcement in deliverWahaReply (or a wrapper) specifically for the case where responseChatId !== chatId (DM-mode trigger routing). Check can_initiate for the resolved contact policy.
**Warning signs:** Agent sends DMs to contacts who should be blocked by policy.

### Pitfall 5: Rules Path Portability
**What goes wrong:** Rules files hardcoded to a machine-specific path break when deployed to hpg6 or reinstalled.
**Why it happens:** Plugin runs in ~/.openclaw/extensions/waha/ — if rules are stored relative to plugin code, they're wiped on reinstall. If hardcoded absolute path, breaks on different machines.
**How to avoid:** Make rules base path configurable via config (e.g., waha.rulesPath). Default to ~/.openclaw/workspace/skills/waha-openclaw-channel/rules/ — this path persists across reinstalls (it's the workspace/dev copy). Document in config-schema.ts and README.
**Warning signs:** Rules disappear after npm install / plugin reinstall.

### Pitfall 6: Missing _default.yaml at Runtime
**What goes wrong:** Plugin starts, first message arrives, rules-loader tries to read _default.yaml, file doesn't exist — uncaught error bubbles up and crashes message processing.
**Why it happens:** No Wave 0 setup task creates the defaults; or gateway restarted after deploy without creating files.
**How to avoid:** In rules-resolver.ts, catch missing _default.yaml with clear error message and fall back to hardcoded system defaults (not undefined). Log at ERROR level. Never throw from the resolver — degrade gracefully.
**Warning signs:** First message after deploy crashes inbound handler.

---

## Code Examples

### YAML Safe Parse with zod Validation
```typescript
// Source: yaml package docs + project zod usage pattern (config-schema.ts)
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const ContactRuleSchema = z.object({
  enabled: z.boolean().optional(),
  trust_level: z.enum(["blocked", "low", "normal", "trusted", "owner"]).optional(),
  can_initiate: z.boolean().optional(),
  can_reply: z.boolean().optional(),
  // ... other fields
}).partial();  // all fields optional for sparse override files

export function loadContactRule(filePath: string): Partial<ContactRule> | null {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = parseYaml(raw);  // safe by default, no code execution
    const result = ContactRuleSchema.safeParse(parsed);
    if (!result.success) {
      console.warn(`[waha] rules: malformed override ${filePath}: ${result.error.message}`);
      return null;
    }
    return result.data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;  // file not found = no override
    console.warn(`[waha] rules: failed to read ${filePath}: ${String(err)}`);
    return null;
  }
}
```

### 5-Layer Merge Engine
```typescript
// Source: resolver-algorithm.md Section F
// Scalars: replace. Arrays: replace. Objects: deep merge.
export function mergeRuleLayers<T extends Record<string, unknown>>(
  layers: Array<Partial<T> | null | undefined>
): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;  // missing = inherit
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        // Deep merge objects
        result[key] = mergeRuleLayers([result[key] as Partial<T>, value as Partial<T>]);
      } else {
        // Scalars and arrays: replace
        result[key] = value;
      }
    }
  }
  return result as Partial<T>;
}
```

### Stable ID Normalization
```typescript
// Source: whatsapp-rules-schema.yaml identity section
export function normalizeToStableId(jid: string): string {
  const trimmed = jid.trim().toLowerCase();
  if (trimmed.endsWith("@g.us")) return `@g:${trimmed}`;
  if (trimmed.endsWith("@lid")) return `@lid:${trimmed}`;
  if (trimmed.endsWith("@c.us")) return `@c:${trimmed}`;
  // Bare phone number
  if (/^\d+$/.test(trimmed)) return `@c:${trimmed}@c.us`;
  return `@c:${trimmed}`;  // best effort
}

export function resolveContactFileId(jid: string): string {
  // Maps to filesystem-safe ID component
  return jid.replace(/[@.]/g, "_").replace(/[^a-z0-9_]/gi, "");
}
```

### Inbound Hook Insertion Point in handleWahaInbound
```typescript
// Insert after line ~477 (after DM keyword filter block) in inbound.ts:
// Rules resolve AFTER all hard filters — only messages reaching agent get policy loaded
let resolvedPolicy: ResolvedPolicy | null = null;
try {
  resolvedPolicy = await resolveInboundPolicy({
    isGroup,
    chatId,
    senderId,
    cfg: config,
    rulesBasePath: getRulesBasePath(config),
  });
} catch (err) {
  runtime.log?.(`waha: rules resolution failed for ${chatId}: ${String(err)}`);
  // Non-fatal: proceed without policy injection
}

// Then in ctxPayload:
const ctxPayload = core.channel.reply.finalizeInboundContext({
  // ...existing fields...
  ...(resolvedPolicy ? { WahaResolvedPolicy: JSON.stringify(resolvedPolicy) } : {}),
});
```

### Authorization Matrix Check
```typescript
// Source: resolver-algorithm.md Section E
export function checkManagerAuthorization(params: {
  actorId: string;    // stable @c: or @lid: id
  ownerId: string;    // from config/schema meta.owner_id
  action: "edit_policy" | "appoint_manager" | "revoke_manager";
  scope: "global" | "contact" | "group";
  scopeManagers: string[];      // from relevant scope's managers.allowed_ids
  globalManagers: string[];     // from global default managers.allowed_ids
}): { allowed: boolean; reason: string } {
  const { actorId, ownerId, action, scope, scopeManagers, globalManagers } = params;
  const isOwner = actorId === ownerId;

  if (action === "appoint_manager" || action === "revoke_manager") {
    if (isOwner) return { allowed: true, reason: "owner" };
    return { allowed: false, reason: "only owner can appoint/revoke managers" };
  }

  if (isOwner) return { allowed: true, reason: "owner" };
  if (globalManagers.includes(actorId)) return { allowed: true, reason: "global_manager" };
  if (scope !== "global" && scopeManagers.includes(actorId)) return { allowed: true, reason: "scope_manager" };
  return { allowed: false, reason: "not_authorized" };
}
```

---

## Architecture — Integration Points

### Existing Code Integration Map

| Existing File | How Rules System Hooks In |
|--------------|--------------------------|
| `inbound.ts` `handleWahaInbound` | Insert inbound policy resolver call AFTER line ~477 (after DM filter). Attach compact payload to ctxPayload. |
| `send.ts` `assertCanSend` | Add or call assertPolicyCanSend alongside assertCanSend for outbound enforcement |
| `normalize.ts` | Extend with normalizeToStableId and resolveContactFileId — pure functions, same pattern |
| `channel.ts` `handleAction` | Add policy-edit action handler (new action name, e.g., "editPolicy") in ACTION_HANDLERS map |
| `types.ts` | Add RulesConfig to WahaAccountConfig (rulesPath field), add ResolvedPolicy types |
| `config-schema.ts` | Add rulesPath to zod schema for config validation |
| `monitor.ts` | No changes in v1 — admin UI for rules is deferred |

### Exact Insertion Point in inbound.ts

The hard filter chain in handleWahaInbound runs in this order (verified by reading the file):
1. Line ~144: Pre-check allowedGroups (quick bail before media preprocessing)
2. Line ~322: Trigger word detection
3. Line ~340: allowedGroups check (full)
4. Line ~352: Group keyword filter
5. Line ~364+: DM policy resolution (dmPolicy, groupPolicy, allowFrom)
6. Line ~416: Group/DM access decision gate
7. Line ~467: DM keyword filter (dmFilter.check)
8. Line ~486: Directory upsert
9. Line ~494: Per-DM settings enforcement
10. **INSERT RULES RESOLVER HERE** — after line ~526 (after per-DM settings), before ctxPayload construction at line ~564

This placement ensures rules only load for messages that have passed ALL existing gates — the minimal load principle.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No per-contact/group policy | Hard-coded allowFrom lists | Phase 6 | Policy becomes declarative and per-contact |
| Model memorizes rules across turns | Plugin resolves and injects per turn | Phase 6 | Rules are reliable; don't depend on model memory |
| All rules loaded at startup | Lazy load per event | Phase 6 | No startup context bloat |

**No deprecated patterns here** — this is a new subsystem. It builds on lru-cache (Phase 1 pattern) and pure-module extraction (Phases 3-4 pattern).

---

## Open Questions

1. **Rules base path default**
   - What we know: Workspace path is ~/.openclaw/workspace/skills/waha-openclaw-channel/; extension path is ~/.openclaw/extensions/waha/
   - What's unclear: Which path persists across `npm install`? Whether OpenClaw exposes a workspace root API.
   - Recommendation: Default to `~/.openclaw/workspace/skills/waha-openclaw-channel/rules/`, make configurable via `waha.rulesPath` in config. Document clearly in README.

2. **How does the model consume WahaResolvedPolicy in ctxPayload**
   - What we know: ctxPayload fields like MentionedJids (Phase 3) and ChatType pass through to the model turn. The model receives the context payload.
   - What's unclear: Whether the gateway surfaces arbitrary extra fields to the model, or only known schema fields. The OpenClaw SDK finalizeInboundContext signature is not inspectable here.
   - Recommendation: Test with a non-critical field first (log what the model receives). If arbitrary fields are filtered, use the Body field to append a compact JSON block like `[policy: {...}]` appended to the message body. Phase 1 of this feature should validate the injection mechanism with a simple test.

3. **Policy-edit command path: action vs DM parsing**
   - What we know: The action routing in channel.ts handles named actions. The inbound flow handles free-text messages.
   - What's unclear: Should policy editing be a new named action (e.g., "editContactPolicy") invocable by the LLM, or should it be detected from DM command text?
   - Recommendation: Implement as a named action handler in ACTION_HANDLERS (channel.ts). This is cleaner than text parsing, aligns with existing patterns, and gives the LLM a typed interface with parameters.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | vitest.config.ts (exists, no test dir specified — picks up tests/*.test.ts) |
| Quick run command | `npm test -- --reporter=verbose` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RULES-01 | YAML load returns parsed object; missing file returns null; malformed returns null+warn | unit | `npm test -- --reporter=verbose tests/rules-loader.test.ts` | Wave 0 |
| RULES-02 | JID->@c:, LID->@lid:, GroupJID->@g: normalization; bare phone handled | unit | `npm test -- --reporter=verbose tests/identity-resolver.test.ts` | Wave 0 |
| RULES-03 | 5-layer merge: scalar replace, object deep merge, array replace, missing=inherit | unit | `npm test -- --reporter=verbose tests/rules-merge.test.ts` | Wave 0 |
| RULES-04 | DM resolution: global default only; with override; malformed override falls back | unit | `npm test -- --reporter=verbose tests/rules-resolver.test.ts` | Wave 0 |
| RULES-05 | Group resolution: everyone/explicit/none allowlist; unknown participant policies; contact_rule_mode=ignore skips contact load | unit | `npm test -- --reporter=verbose tests/rules-resolver.test.ts` | Wave 0 |
| RULES-06 | Outbound enforcement: can_initiate=false blocks DM; participation_mode=silent_observer blocks group send | unit | `npm test -- --reporter=verbose tests/policy-enforcer.test.ts` | Wave 0 |
| RULES-07 | Cache hit returns cached; stale mtime = cache miss; TTL expiry = cache miss | unit | `npm test -- --reporter=verbose tests/policy-cache.test.ts` | Wave 0 |
| RULES-08 | Auth matrix: owner always allowed; global manager can edit not appoint; scope manager limited; non-manager denied | unit | `npm test -- --reporter=verbose tests/manager-authorizer.test.ts` | Wave 0 |
| RULES-09 | DM payload has correct fields; group payload has correct fields; no raw YAML content | unit | `npm test -- --reporter=verbose tests/resolved-payload-builder.test.ts` | Wave 0 |
| RULES-10 | ctxPayload includes WahaResolvedPolicy when resolver succeeds; omits field on error | integration | manual verification via gateway logs | N/A — gate test |
| RULES-11 | editPolicy action: authorized edit persists to file; unauthorized returns error | unit | `npm test -- --reporter=verbose tests/policy-edit.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- tests/rules-merge.test.ts` (relevant module tests)
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/rules-loader.test.ts` — covers RULES-01
- [ ] `tests/identity-resolver.test.ts` — covers RULES-02
- [ ] `tests/rules-merge.test.ts` — covers RULES-03
- [ ] `tests/rules-resolver.test.ts` — covers RULES-04, RULES-05
- [ ] `tests/policy-enforcer.test.ts` — covers RULES-06
- [ ] `tests/policy-cache.test.ts` — covers RULES-07
- [ ] `tests/manager-authorizer.test.ts` — covers RULES-08
- [ ] `tests/resolved-payload-builder.test.ts` — covers RULES-09
- [ ] `tests/policy-edit.test.ts` — covers RULES-11
- [ ] `rules/contacts/_default.yaml` — required seed file (RULES-12)
- [ ] `rules/groups/_default.yaml` — required seed file (RULES-12)
- [ ] Framework install: `npm install yaml` — YAML parser not currently installed

---

## Sources

### Primary (HIGH confidence)
- `docs/extra phase/claude-code-handoff.md` — Core product requirements, implementation plan, constraints
- `docs/extra phase/resolver-algorithm.md` — Step-by-step resolver flows A-L, auth matrix, merge rules, error handling, security posture
- `docs/extra phase/whatsapp-rules-loading-design.md` — Loading design, hook system, file layout, interaction with WAHA filters
- `docs/extra phase/whatsapp-rules-schema.yaml` — Full schema: field types, defaults, enums, examples
- `src/inbound.ts` (read lines 1-600) — Exact integration point for inbound hook, verified filter chain order
- `src/send.ts` (read lines 1-60) — assertCanSend pattern for outbound enforcement
- `src/normalize.ts` — Existing normalization pattern to extend
- `src/types.ts` — Config types structure for adding rulesPath
- `package.json` — Verified dependencies: lru-cache ^11.2.6, zod ^4.3.6 installed; yaml NOT installed

### Secondary (MEDIUM confidence)
- `src/trigger-word.ts` / `src/mentions.ts` / `src/dedup.ts` — Pattern evidence for extract-for-testability convention
- `tests/trigger-word.test.ts` — vitest test pattern used by project (import style, describe/it/expect)
- `vitest.config.ts` — Test runner config (globals: false, environment: node)

### Tertiary (LOW confidence)
- Node.js built-in `fs/promises` stat() for mtime — standard, no verification needed
- yaml npm package as best YAML parser — well-established ecosystem knowledge, not formally verified via Context7

---

## Metadata

**Confidence breakdown:**
- Design spec: HIGH — all four design documents are complete and unambiguous
- Standard stack: HIGH — existing deps verified in package.json; yaml package is the clear choice
- Architecture: HIGH — integration points verified by reading actual source files
- Pitfalls: HIGH — sourced from direct codebase reading (LID issue documented in CLAUDE.md, ctxPayload pattern from inbound.ts)
- Test gaps: HIGH — tests/ directory confirmed, vitest confirmed, all test files are Wave 0 gaps

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable design; no external moving parts)
