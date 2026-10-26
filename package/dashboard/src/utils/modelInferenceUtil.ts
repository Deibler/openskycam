/** Stable representation for immutable versions; property order is not identity. */
export function canonicalModel(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalModel).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalModel(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

/** Preserve recorded calendar dates; never infer a timezone for legacy checkpoints. */
export function recordedModelDate(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)
  )
    return null;
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null;
  return value.length === 10 || Number.isFinite(Date.parse(value)) ? value : null;
}
