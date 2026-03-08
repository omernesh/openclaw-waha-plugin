/**
 * DM Keyword Filter for OpenClaw WAHA plugin.
 * Filters inbound DM messages by keyword BEFORE they reach the AI agent.
 * Fail-open: any error allows message through.
 */

export type DmFilterConfig = {
  enabled?: boolean;
  mentionPatterns?: string[];
  godModeBypass?: boolean;
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

  constructor(config: DmFilterConfig) {
    this._config = config;
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

  check(params: { text: string; senderId: string; log?: (msg: string) => void }): DmFilterResult {
    try {
      return this._check(params);
    } catch {
      return { pass: true, reason: "error" };
    }
  }

  private _check(params: { text: string; senderId: string; log?: (msg: string) => void }): DmFilterResult {
    const { text, senderId, log } = params;
    const cfg = this._config;

    if (!cfg.enabled) {
      this._stats.allowed++;
      return { pass: true, reason: "filter_disabled" };
    }

    // God mode bypass: super-users skip the filter
    if (cfg.godModeBypass !== false && cfg.godModeSuperUsers?.length) {
      const normalized = normalizePhoneIdentifier(senderId);
      const isGod = cfg.godModeSuperUsers.some((u) => {
        if (u.passwordRequired) return false;
        return normalizePhoneIdentifier(u.identifier) === normalized;
      });
      if (isGod) {
        this._stats.allowed++;
        this._record(true, "god_mode", text);
        log?.(`dm-filter: allow ${senderId} (god mode)`);
        return { pass: true, reason: "god_mode" };
      }
    }

    const patterns = cfg.mentionPatterns ?? [];
    if (patterns.length === 0) {
      this._stats.allowed++;
      return { pass: true, reason: "no_restriction" };
    }

    // Build/reuse regex cache
    const cacheKey = patternsHash(patterns);
    if (cacheKey !== this._regexCacheKey) {
      this._regexCache = patterns.map((p) => new RegExp(p, "i"));
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
