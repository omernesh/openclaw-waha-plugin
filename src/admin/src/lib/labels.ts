// Human-readable labels for config keys — confirmed from monitor.ts lines 1672-1696
// DO NOT CHANGE: This map is the source of truth for all admin panel label display.
// Add new keys here when new config fields are introduced.

export const LABEL_MAP: Record<string, string> = {
  wpm: 'Words Per Minute',
  readDelayMs: 'Read Delay (ms)',
  typingDurationMs: 'Typing Duration (ms)',
  pauseChance: 'Pause Chance',
  presenceEnabled: 'Presence Enabled',
  groupFilter: 'Group Filter',
  dmFilter: 'DM Filter',
  allowFrom: 'Allow From',
  groupAllowFrom: 'Group Allow From',
  allowedGroups: 'Allowed Groups',
  godModeSuperUsers: 'God Mode Users',
  dmPolicy: 'DM Policy',
  groupPolicy: 'Group Policy',
  mentionPatterns: 'Mention Patterns',
  keywords: 'Keywords',
  triggerOperator: 'Trigger Operator',
  globalKeywords: 'Global Keywords',
  groupKeywords: 'Group Keywords',
  enabled: 'Enabled',
  jitter: 'Jitter',
  baseUrl: 'Base URL',
  webhookPort: 'Webhook Port',
  serverTime: 'Server Time',
}

export function labelFor(key: string): string {
  return LABEL_MAP[key] ?? key
}
