// §7.3 — all timestamps are RFC3339Nano UTC. JS Date only has ms precision, so pad to
// nanoseconds deterministically (append 6 zero digits) to keep the wire format stable.
export function toRfc3339Nano(input: Date | string | number = new Date()): string {
  const d = input instanceof Date ? input : new Date(input);
  // "2026-06-02T10:30:00.123Z" → "2026-06-02T10:30:00.123000000Z"
  const iso = d.toISOString();
  return iso.replace(/\.(\d{3})Z$/, '.$1000000Z');
}

export function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
