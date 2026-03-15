---
phase: quick
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/http-client.ts
autonomous: true
requirements: [FIX-DUP-SEND]

must_haves:
  truths:
    - "POST mutations that timeout do not get re-sent when the gateway retries the action"
    - "Non-mutation (GET) requests are unaffected by dedup logic"
    - "Dedup entries expire after a configurable TTL so stale entries don't block future legitimate sends"
  artifacts:
    - path: "src/http-client.ts"
      provides: "Mutation dedup layer in callWahaApi"
      contains: "MutationDedup"
  key_links:
    - from: "callWahaApi"
      to: "MutationDedup"
      via: "dedup check before fetch, mark pending on timeout"
      pattern: "recentMutations"
---

<objective>
Fix duplicate WhatsApp messages caused by gateway retries after WAHA API timeouts.

Purpose: When a POST to WAHA times out after 30s, the message likely DID send but WAHA could not confirm. The OpenClaw gateway then retries the action, causing the plugin to re-send the same message 2-3x. This plan adds a mutation deduplication layer in http-client.ts (the single chokepoint for all WAHA API calls) that detects retry attempts of the same mutation within a time window and short-circuits them.

Output: Updated http-client.ts with MutationDedup class and integration into callWahaApi.
</objective>

<execution_context>
@C:/Users/omern/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/omern/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/http-client.ts

<interfaces>
<!-- Key types and contracts the executor needs. -->

From src/http-client.ts:
```typescript
export interface CallWahaApiParams {
  baseUrl: string;
  apiKey: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  context?: { action?: string; chatId?: string };
  skipRateLimit?: boolean;
  timeoutMs?: number;
}

export async function callWahaApi(params: CallWahaApiParams): Promise<any>;
export function configureReliability(opts: { timeoutMs?: number; capacity?: number; refillRate?: number }): void;
export function _resetForTesting(): void;
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add MutationDedup class and integrate into callWahaApi</name>
  <files>src/http-client.ts</files>
  <behavior>
    - Test 1: Two identical POST calls to same path+body within TTL window — second call throws "duplicate mutation suppressed" error instead of hitting fetch
    - Test 2: Two identical GET calls — both proceed normally (GETs are not mutations, not deduped)
    - Test 3: POST that succeeds (200) does NOT mark as pending — a subsequent identical POST proceeds normally
    - Test 4: POST that times out marks the mutation as pending — retry within TTL is suppressed
    - Test 5: After TTL expires, a previously-suppressed mutation key is cleared — same mutation can proceed again
    - Test 6: Different chatId or different text body produces different dedup keys — not suppressed
    - Test 7: _resetForTesting clears the dedup map
  </behavior>
  <action>
Add a MutationDedup class to http-client.ts that tracks recently-timed-out mutations:

```
class MutationDedup:
  - Private Map<string, number> storing mutationKey -> timestamp
  - TTL: 60_000ms (1 minute — covers gateway retry window)
  - Max entries: 500 (bounded, prune expired on each check)

  buildKey(method, path, body):
    - Only for mutations (POST/PUT/DELETE), return null for GET
    - Key = `${method}:${path}:${stableHash(body)}` where stableHash is JSON.stringify sorted keys then simple string hash
    - Include chatId and session from body if present for specificity

  isPending(key): boolean
    - Returns true if key exists and not expired
    - Prunes expired entries opportunistically

  markPending(key): void
    - Sets key with current timestamp

  clear(): void
    - For _resetForTesting
```

Integrate into callWahaApi flow:
1. BEFORE the fetch (after rate limit + backoff), compute mutation key
2. If key is pending (from a previous timeout), throw immediately:
   `[WAHA] Duplicate mutation suppressed (original timed out, may have already succeeded): ${method} ${path}`
   Log a console.warn with the suppression
3. In the catch block for timeout errors (line ~227-231), if isMutation, call markPending(key) BEFORE throwing the timeout error
4. On successful response (non-429, non-error), do NOT mark pending — the mutation completed normally

Add `mutationDedup` to _resetForTesting() to clear the map.

IMPORTANT constraints:
- DO NOT change the callWahaApi function signature (callers depend on it per DO NOT CHANGE comment)
- DO NOT change any existing error messages — only add the new suppression path
- DO NOT change existing timeout, rate limiting, or retry logic
- Add a DO NOT CHANGE comment block around the MutationDedup class explaining its purpose
- Use the same code style as the existing TokenBucket class (module-level instance, class with methods)
- The stableHash function should be simple — no crypto needed, just a basic string hash of JSON.stringify with sorted keys
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>
    - MutationDedup class exists in http-client.ts with buildKey, isPending, markPending, clear methods
    - callWahaApi checks dedup before fetch for mutations
    - Timed-out mutations are marked pending so retries are suppressed
    - GET requests bypass dedup entirely
    - Successful mutations are NOT marked pending
    - _resetForTesting clears the dedup map
    - All existing DO NOT CHANGE contracts preserved
    - TypeScript compiles without errors
  </done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` — TypeScript compiles
- Review the diff to confirm: only additions, no modifications to existing function signatures or error messages
- Confirm MutationDedup map is bounded (max 500 entries) and entries expire (60s TTL)
</verification>

<success_criteria>
- Gateway retry after a timeout no longer causes duplicate WAHA API calls for the same mutation
- GET requests are completely unaffected
- The dedup map is bounded and self-cleaning (no memory leaks)
- All existing http-client.ts behavior preserved (timeout, rate limit, 429 retry, logging)
</success_criteria>

<output>
After completion, create `.planning/quick/1-fix-duplicate-messages-and-timeout-issue/1-SUMMARY.md`
</output>
