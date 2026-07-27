export const MIN_REDACTION_STRENGTH = 2;
export const MAX_REDACTION_STRENGTH = 12;
export const DEFAULT_REDACTION_STRENGTH = 3;

export function normalizeRedactionStrength(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(
    MAX_REDACTION_STRENGTH,
    Math.max(MIN_REDACTION_STRENGTH, Math.round(numeric)),
  );
}

export function resolveRedactionStrength(override, fallback) {
  return (
    normalizeRedactionStrength(override) ??
    normalizeRedactionStrength(fallback) ??
    DEFAULT_REDACTION_STRENGTH
  );
}

export function redactionStrengthRecord(mask) {
  return {
    redactionStrength: normalizeRedactionStrength(mask?.redactionStrength),
  };
}
