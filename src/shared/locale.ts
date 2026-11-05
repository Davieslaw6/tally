/** Validation for user-supplied formatting preferences. */
export function isValidLocale(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const candidate = value.trim();
  if (!candidate || candidate.length > 20) return false;
  try {
    const canonical = Intl.getCanonicalLocales(candidate);
    return canonical.length === 1 && canonical[0] === candidate;
  } catch {
    return false;
  }
}

export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const candidate = value.trim();
  if (!candidate || candidate.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

export function normalizeLocale(value: unknown, fallback = 'en-US'): string {
  return isValidLocale(value) ? value.trim() : fallback;
}

export function normalizeTimezone(value: unknown, fallback = 'UTC'): string {
  return isValidTimezone(value) ? value.trim() : fallback;
}
