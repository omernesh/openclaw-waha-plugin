// ╔══════════════════════════════════════════════════════════════════════╗
// ║  ERROR FORMATTER — DO NOT CHANGE                                    ║
// ║                                                                     ║
// ║  Centralized action error to LLM message mapper. Converts raw       ║
// ║  errors into actionable guidance for the AI agent (the LLM).        ║
// ║                                                                     ║
// ║  Added in Phase 2, Plan 01 (2026-03-11).                           ║
// ║  Every handleAction error flows through formatActionError().         ║
// ║                                                                     ║
// ║  DO NOT remove pattern entries without testing LLM responses.       ║
// ║  DO NOT change the output format — LLM prompts depend on it.       ║
// ╚══════════════════════════════════════════════════════════════════════╝

/**
 * Error pattern → suggestion mapping.
 * Order matters: first match wins. More specific patterns go first.
 */
const ERROR_SUGGESTIONS: Array<{ pattern: RegExp; suggestion: string }> = [
  // Rate limiting
  { pattern: /429|rate.?limit/i, suggestion: "wait a moment and retry the request" },
  // Timeout
  { pattern: /timed?\s*out|timeout|abort/i, suggestion: "try again — the request may have succeeded if it was a mutation" },
  // Not found / no matches
  { pattern: /no\s+match|not\s+found|could\s+not\s+resolve/i, suggestion: "use the search action to find the correct target" },
  // Missing required fields
  { pattern: /requires\s+chatId|requires\s+a\s+target/i, suggestion: "specify the target chat or group JID" },
  { pattern: /requires\s+messageId/i, suggestion: "provide the full messageId (format: true_chatId_shortId)" },
  // Auth / forbidden
  { pattern: /401|unauthorized|forbidden|403/i, suggestion: "do not retry — check API key configuration" },
  // Session health
  { pattern: /disconnect|unhealthy|session.*(down|lost|closed)/i, suggestion: "do not retry until the session has reconnected" },
];

/** Default suggestion when no pattern matches. */
const DEFAULT_SUGGESTION = "try again or use a different approach";

/**
 * Format an action error into an LLM-friendly message.
 *
 * Output format: "Failed to {action} {target}: {cleanMsg}. Try: {suggestion}"
 *
 * Logs the full original error with console.warn BEFORE formatting,
 * so operators can see the raw error in logs while the LLM gets clean guidance.
 *
 * @param err - The caught error (unknown type)
 * @param ctx - Action context: action name and optional target
 * @returns Formatted error string for LLM consumption
 */
export function formatActionError(
  err: unknown,
  ctx: { action: string; target?: string },
): string {
  const rawMsg = err instanceof Error ? err.message : (err ? String(err) : "unknown error (no details provided)");

  // Log full original error for operators BEFORE formatting — raw context helps debug issues that the cleaned LLM message omits
  console.warn(`[WAHA] Action error in ${ctx.action}${ctx.target ? ` (${ctx.target})` : ""}: ${rawMsg}`);

  // Strip [WAHA] prefix for clean LLM output
  const cleanMsg = rawMsg.replace(/^\[WAHA\]\s*/i, "").trim();

  // Find matching suggestion
  let suggestion = DEFAULT_SUGGESTION;
  for (const entry of ERROR_SUGGESTIONS) {
    if (entry.pattern.test(rawMsg)) {
      suggestion = entry.suggestion;
      break;
    }
  }

  // Build formatted message
  const targetPart = ctx.target ? ` ${ctx.target}` : "";
  return `Failed to ${ctx.action}${targetPart}: ${cleanMsg}. Try: ${suggestion}`;
}
