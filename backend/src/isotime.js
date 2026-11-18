/**
 * ISO-8601 handling at the precision the evidence was written in.
 *
 * The Python backend used datetime.fromisoformat / .isoformat(), which carry
 * microseconds. JavaScript's Date carries milliseconds, so round-tripping a
 * timestamp through it silently drops three digits. That matters here: the
 * collected sshd logs contain events microseconds apart
 * (…:40.080802 and …:40.081440 are different events), and truncating them
 * would make two distinct records look simultaneous and reorder them.
 *
 * So the fractional part is carried as text and never converted. Only the
 * whole-second part goes through date arithmetic, which is safe because UTC
 * offsets are always whole minutes - converting a zone can never change the
 * fraction.
 */

const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|z|[+-]\d{2}:?\d{2})?$/;

/** Split an ISO string into parts, or null if it is not one we accept. */
export function parseIso(value) {
  if (typeof value !== 'string') return null;
  const match = ISO_PATTERN.exec(value.trim());
  if (!match) return null;

  const [, y, mo, d, h, mi, s, frac, zone] = match;

  let offsetMinutes = null;
  if (zone) {
    if (zone === 'Z' || zone === 'z') {
      offsetMinutes = 0;
    } else {
      const sign = zone[0] === '-' ? -1 : 1;
      const body = zone.slice(1).replace(':', '');
      offsetMinutes = sign * (Number(body.slice(0, 2)) * 60 + Number(body.slice(2, 4)));
    }
  }

  return {
    year: Number(y), month: Number(mo), day: Number(d),
    hour: Number(h), minute: Number(mi), second: Number(s),
    fraction: frac || '',
    offsetMinutes,
  };
}

const pad = (n, width = 2) => String(n).padStart(width, '0');

function formatOffset(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function formatParts(parts) {
  const fraction =
    parts.fraction && !/^\.0+$/.test(parts.fraction) ? parts.fraction : '';
  return (
    `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}` +
    `T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}` +
    `${fraction}${formatOffset(parts.offsetMinutes)}`
  );
}

/**
 * The Python `_timestamp` helper: a canonical ISO string for an offset-aware
 * input, and null for anything naive or unparseable. A naive timestamp is
 * rejected rather than assumed to be UTC - guessing a zone here would invent
 * an instant the log never claimed.
 */
export function normalizeIso(value) {
  const parts = parseIso(value);
  if (!parts || parts.offsetMinutes === null) return null;
  return formatParts(parts);
}

/** Whole seconds since the epoch for the given parts, ignoring the fraction. */
function epochSecondsOf(parts) {
  const utc = Date.UTC(
    parts.year, parts.month - 1, parts.day,
    parts.hour, parts.minute, parts.second,
  );
  return Math.floor(utc / 1000) - parts.offsetMinutes * 60;
}

/**
 * The same instant expressed in UTC, with the original fractional digits
 * carried across untouched.
 */
export function toUtcIso(value) {
  const parts = parseIso(value);
  if (!parts || parts.offsetMinutes === null) return null;
  const asUtc = new Date(epochSecondsOf(parts) * 1000);
  return formatParts({
    year: asUtc.getUTCFullYear(), month: asUtc.getUTCMonth() + 1, day: asUtc.getUTCDate(),
    hour: asUtc.getUTCHours(), minute: asUtc.getUTCMinutes(), second: asUtc.getUTCSeconds(),
    fraction: parts.fraction,
    offsetMinutes: 0,
  });
}

/**
 * Milliseconds since the epoch, for comparisons only. Millisecond resolution
 * is ample for the two-minute clock tolerance and never reaches storage.
 */
export function epochMs(value) {
  const parts = parseIso(value);
  if (!parts || parts.offsetMinutes === null) return null;
  const fractionMs = parts.fraction ? Math.floor(Number(parts.fraction) * 1000) : 0;
  return epochSecondsOf(parts) * 1000 + fractionMs;
}

/** Current time as an offset-aware UTC string, matching the Python format. */
export function utcNowIso() {
  const now = new Date();
  return formatParts({
    year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate(),
    hour: now.getUTCHours(), minute: now.getUTCMinutes(), second: now.getUTCSeconds(),
    fraction: `.${pad(now.getUTCMilliseconds(), 3)}000`,
    offsetMinutes: 0,
  });
}
