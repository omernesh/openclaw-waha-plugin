/**
 * policy-enforcer.ts — Outbound policy enforcement gate for the WhatsApp Rules System.
 * Added in Phase 6, Plan 04 (2026-03-14).
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  assertPolicyCanSend — Outbound policy enforcement. DO NOT CHANGE.  ║
 * ║                                                                      ║
 * ║  Fail-open design: if rules system is not set up, or if resolution  ║
 * ║  fails for any reason, sends are ALLOWED (not blocked).             ║
 * ║  We only block on EXPLICIT policy denial (can_initiate=false or     ║
 * ║  participation_mode=silent_observer).                                ║
 * ║                                                                      ║
 * ║  WHY FAIL-OPEN: The rules system should never be able to silently    ║
 * ║  prevent all sends due to a bug, missing files, or misconfiguration. ║
 * ║  Hard blocks are reserved for explicit policy decisions only.        ║
 * ║                                                                      ║
 * ║  Called by sendWahaText, sendWahaImage, sendWahaVideo, sendWahaFile  ║
 * ║  AFTER assertCanSend (role check). DO NOT reorder.                  ║
 * ║  Added: Phase 6, Plan 04. Verified: 2026-03-14.                     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import * as fs from "fs";
import { getRulesBasePath } from "./identity-resolver.js";
import { resolveOutboundPolicy } from "./rules-resolver.js";
import type { CoreConfig } from "./types.js";

/**
 * Assert that the current outbound policy allows sending to the given chatId.
 *
 * Fail-open: if the rules directory doesn't exist, or if resolution fails,
 * this function returns without throwing (sends are allowed by default).
 *
 * @throws Error if policy explicitly blocks the send (can_initiate=false or silent_observer)
 */
export async function assertPolicyCanSend(chatId: string, cfg: CoreConfig): Promise<void> {
  // Step 1: Get the rules base path
  const basePath = getRulesBasePath(cfg);

  // Step 2: If the rules directory doesn't exist, rules system is not set up — pass silently.
  // Fail-open: never block sends just because rules aren't configured.
  try {
    if (!fs.existsSync(basePath)) {
      return;
    }
  } catch {
    // If existsSync itself fails (permissions, etc.), fail-open
    return;
  }

  // Step 3: Attempt policy resolution — fail-open on any error
  let policy: Awaited<ReturnType<typeof resolveOutboundPolicy>>;
  try {
    policy = await resolveOutboundPolicy({ chatId, basePath });
  } catch {
    // Resolution error — fail-open, do not block send
    return;
  }

  // Step 4: If resolution returned null (error or no rules), fail-open
  if (policy === null) {
    return;
  }

  // Step 5: Check explicit policy denials only
  if (policy.chat_type === "dm" && policy.can_initiate === false) {
    throw new Error(
      `Policy blocks initiating DM to ${chatId}: can_initiate=false. ` +
      `Update contact rules to allow (set can_initiate: true in the contact's rule file).`
    );
  }

  if (policy.chat_type === "group" && policy.participation_mode === "silent_observer") {
    throw new Error(
      `Policy blocks sending to group ${chatId}: participation_mode=silent_observer. ` +
      `Update group rules to allow (set participation_mode to open, mention_only, or another active mode).`
    );
  }

  // Step 6: All other cases — allow the send
}
