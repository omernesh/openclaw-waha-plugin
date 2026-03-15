/**
 * DM Keyword Filter for OpenClaw WAHA plugin.
 * Filters inbound DM messages by keyword BEFORE they reach the AI agent.
 * Fail-open: any error allows message through.
 */

/**
 * God mode scope controls which filter contexts god mode bypass applies to.
 * - "all"  — god mode bypasses both DM and group filters (default, backward-compatible)
 * - "dm"   — god mode only bypasses DM filter, NOT group filter (recommended for human sessions)
 * - "off"  — god mode never bypasses any filter
 * DO NOT CHANGE — this type is used by config-schema.ts and admin panel. Added for human session guardrails.
 */
export type GodModeScope = "all" | "dm" | "off";

/**
 * Filter type identifies whether this filter instance is used for DM or group filtering.
 * Used in conjunction with godModeScope to determine if god mode bypass applies.
 * DO NOT CHANGE — used by inbound.ts to pass context to check(). Added for human session guardrails.
 */
export type FilterType = "dm" | "group";

export type DmFilterConfig = {
  enabled?: boolean;
  mentionPatterns?: string[];
  godModeBypass?: boolean;
  /** Controls which filter types god mode bypass applies to. Default: "all" (backward-compatible). */
  godModeScope?: GodModeScope;
  godModeSuperUsers?: Array<{
    identifier: string;
    platform?: string;
    passwordRequired?: boolean;
  }>;
  tokenEstimate?: number;
};

export type DmFilterStats = {
  dropped: number;
  allowed: number;
  tokensEstimatedSaved: number;
};

export type DmFilterResult =
  | { pass: true; reason: "keyword_match" | "god_mode" | "no_restriction" | "filter_disabled" | "error" }
  | { pass: false; reason: "no_keyword_match" };

// Hash patterns array to a string key for cache invalidation
function patternsHash(patterns: string[]): string {
  return patterns.join("|");
}

export class DmFilter {
  private _config: DmFilterConfig;
  private _stats: DmFilterStats = { dropped: 0, allowed: 0, tokensEstimatedSaved: 0 };
  private _regexCache: RegExp[] = [];
  private _regexCacheKey: string = "";
  private _recentEvents: Array<{ ts: number; pass: boolean; reason: string; preview: string }> = [];
  private readonly _maxEvents = 50;
  private log?: (msg: string) => void;

  constructor(config: DmFilterConfig, log?: (msg: string) => void) {
    this._config = config;
    this.log = log;
  }

  updateConfig(config: DmFilterConfig): void {
    this._config = config;
    // Invalidate regex cache on config update
    this._regexCacheKey = "";
    this._regexCache = [];
  }

  get stats(): DmFilterStats {
    return { ...this._stats };
  }

  get recentEvents() {
    return [...this._recentEvents];
  }

  check(params: { text: string; senderId: string; filterType?: FilterType; log?: (msg: string) => void }): DmFilterResult {
    try {
      return this._check(params);
    } catch (err) {
      console.warn(`[waha] DmFilter.check() threw: ${String(err)}`);
      return { pass: true, reason: "error" };
    }
  }

  private _check(params: { text: string; senderId: string; filterType?: FilterType; log?: (msg: string) => void }): DmFilterResult {
    const { text, senderId, filterType, log } = params;
    const cfg = this._config;

    if (!cfg.enabled) {
      this._stats.allowed++;
      return { pass: true, reason: "filter_disabled" };
    }

    // God mode bypass: super-users skip the filter IF scope allows it.
    // DO NOT CHANGE — godModeScope guardrail for human sessions.
    // When godModeScope is "all" (default), bypass applies to both DM and group filters (backward-compatible).
    // When godModeScope is "dm", bypass ONLY applies when filterType is NOT "group" — group messages from
    //   god mode users still go through keyword matching. This prevents the bot from responding in
    //   groups on behalf of human sessions without explicit trigger word invocation.
    // When godModeScope is "off", god mode bypass is completely disabled regardless of filterType.
    // Added 2026-03-15 for human session guardrails. DO NOT REMOVE.
    if (cfg.godModeBypass !== false && cfg.godModeSuperUsers?.length) {
      const scope: GodModeScope = cfg.godModeScope ?? "all";

      // Validate scope value — warn on unrecognized values and treat as "off" for safety
      if (scope !== "all" && scope !== "dm" && scope !== "off") {
        this.log?.(`dm-filter: unrecognized godModeScope "${scope}", defaulting to "off"`);
      }

      const scopeAllowsBypass =
        scope === "all" || (scope === "dm" && filterType !== "group");

      if (scopeAllowsBypass) {
        const normalized = normalizePhoneIdentifier(senderId);
        const isGod = cfg.godModeSuperUsers.some((u) => {
          if (u.passwordRequired) return false;
          return normalizePhoneIdentifier(u.identifier) === normalized;
        });
        if (isGod) {
          this._stats.allowed++;
          this._record(true, "god_mode", text);
          log?.(`dm-filter: allow ${senderId} (god mode, scope=${scope}, filterType=${filterType ?? "unset"})`);
          return { pass: true, reason: "god_mode" };
        }
      }
    }

    const patterns = cfg.mentionPatterns ?? [];
    if (patterns.length === 0) {
      this._stats.allowed++;
      return { pass: true, reason: "no_restriction" };
    }

    // Build/reuse regex cache — skip invalid patterns instead of failing all.
    // DO NOT CHANGE — invalid regex patterns are logged and skipped, not fatal.
    const cacheKey = patternsHash(patterns);
    if (cacheKey !== this._regexCacheKey) {
      this._regexCache = patterns.reduce<RegExp[]>((acc, p) => {
        try {
          acc.push(new RegExp(p, "i"));
        } catch (err) {
          console.warn(`[waha] DmFilter: invalid regex pattern "${p}": ${String(err)}, skipping`);
        }
        return acc;
      }, []);
      this._regexCacheKey = cacheKey;
    }

    const matched = this._regexCache.some((re) => re.test(text));
    if (matched) {
      this._stats.allowed++;
      this._record(true, "keyword_match", text);
      log?.(`dm-filter: allow ${senderId} (keyword match)`);
      return { pass: true, reason: "keyword_match" };
    }

    // Drop
    this._stats.dropped++;
    this._stats.tokensEstimatedSaved += cfg.tokenEstimate ?? 2500;
    this._record(false, "no_keyword_match", text);
    log?.(`dm-filter: drop ${senderId} (no keyword match in "${text.slice(0, 60)}")`);
    return { pass: false, reason: "no_keyword_match" };
  }

  private _record(pass: boolean, reason: string, text: string): void {
    this._recentEvents.unshift({ ts: Date.now(), pass, reason, preview: text.slice(0, 80) });
    if (this._recentEvents.length > this._maxEvents) {
      this._recentEvents.length = this._maxEvents;
    }
  }
}

/**
 * Normalize Israeli phone numbers and WhatsApp JIDs to bare digits for god mode comparison.
 * Handles: 05X, 972X, +972X, JID suffixes (@c.us, @lid, @s.whatsapp.net)
 */
function normalizePhoneIdentifier(id: string): string {
  let s = id.trim().toLowerCase();
  // Strip JID suffix
  s = s.replace(/@.*$/, "");
  // Strip non-digits except leading +
  s = s.replace(/[^0-9+]/g, "");
  // Normalize +972 -> 972
  if (s.startsWith("+")) s = s.slice(1);
  // Normalize 05X -> 9725X
  if (s.startsWith("05") && s.length === 10) s = "972" + s.slice(1);
  return s;
}
