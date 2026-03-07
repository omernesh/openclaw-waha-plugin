export function normalizeWahaMessagingTarget(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) return "";
  return trimmed
    .replace(/^(waha|whatsapp):/i, "")
    .replace(/^chat:/i, "")
    .trim();
}

export function normalizeWahaAllowEntry(entry: string): string {
  return normalizeWahaMessagingTarget(entry).toLowerCase();
}

export function resolveWahaAllowlistMatch(params: { allowFrom: string[]; senderId: string }): {
  allowed: boolean;
} {
  const sender = normalizeWahaAllowEntry(params.senderId);
  const allowFrom = params.allowFrom.map(normalizeWahaAllowEntry);
  if (allowFrom.includes("*")) {
    return { allowed: true };
  }
  if (!sender) {
    return { allowed: false };
  }
  return { allowed: allowFrom.includes(sender) };
}
