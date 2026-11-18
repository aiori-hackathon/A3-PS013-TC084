/**
 * Cross-platform log normalization; preserves the original raw line.
 *
 * A direct port of backend/app/parser.py. The behaviour is deliberately
 * identical, including which fields are left unset and which warnings are
 * recorded: this is the function that decides what a piece of evidence is
 * said to be, so a difference here would be a difference in the evidence.
 */
import { DateTime } from 'luxon';
import { normalizeIso, toUtcIso, epochMs } from './isotime.js';

const SYSLOG = /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\b/;
const MACOS = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{4})\s/;
const ISO = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\b/;

/**
 * How far a source clock may differ from receipt time before it is worth
 * reporting. Covers ordinary NTP drift and the delay between a line being
 * written and the batch reaching the server.
 */
export const CLOCK_TOLERANCE_SECONDS = 120;

const MONTHS = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

const WINDOWS_EVENTS = {
  4625: ['failed_login', 'warning'],
  4624: ['successful_login', 'info'],
  4634: ['logout', 'info'],
  4740: ['account_lockout', 'warning'],
};

export function parseLog(
  line,
  deviceId,
  batchId,
  logType,
  receivedAt = null,
  sourceTimezone = 'Asia/Kolkata',
) {
  const event = {
    device_id: deviceId, batch_id: batchId, log_type: logType,
    raw_log: line, timestamp: null, timestamp_inferred: false,
    timestamp_conflict: false, timestamp_source: 'unknown',
    source_timezone: sourceTimezone, received_at: receivedAt,
    event_type: 'unknown', severity: 'info', username: null,
    log_format: 'unknown', parse_status: 'partial', parse_warnings: [],
    clock_offset_seconds: null, clock_skew: 'unknown',
  };

  let message = line;
  let match;

  if (line.trimStart().startsWith('{')) {
    try {
      const obj = JSON.parse(line);
      if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
        throw new Error('JSON log must be an object');
      }
      if ('EventID' in obj || 'EventId' in obj) {
        event.log_format = 'windows_event_json';
        const eventId = Number.parseInt(obj.EventID ?? obj.EventId, 10);
        if (WINDOWS_EVENTS[eventId]) {
          [event.event_type, event.severity] = WINDOWS_EVENTS[eventId];
        }
        event.username = obj.TargetUserName || obj.AccountName || null;
        event.timestamp = normalizeIso(obj.TimeCreated || obj.timestamp);
        event.timestamp_source = event.timestamp ? 'embedded' : 'unknown';
        message = String(obj.Message || '');
      } else {
        event.log_format = 'json';
        message = String(obj.message || obj.msg || '');
        event.timestamp = normalizeIso(obj.timestamp || obj.time);
        event.timestamp_source = event.timestamp ? 'embedded' : 'unknown';
        event.username = obj.username ?? null;
      }
    } catch {
      event.parse_warnings.push('Invalid JSON log');
    }
  } else if ((match = MACOS.exec(line))) {
    event.log_format = 'macos_unified_text';
    event.timestamp = normalizeIso(match[1].replace(' ', 'T'));
    event.timestamp_source = event.timestamp ? 'embedded' : 'unknown';
  } else if ((match = SYSLOG.exec(line))) {
    event.log_format = 'linux_syslog';
    if (receivedAt) {
      const inferred = inferSyslogTimestamp(match[1], receivedAt, sourceTimezone);
      if (inferred) {
        event.timestamp = inferred.timestamp;
        event.timestamp_inferred = true;
        event.timestamp_conflict = inferred.conflict;
        event.timestamp_source = 'syslog_inferred';
      } else {
        event.parse_warnings.push('Could not infer syslog timestamp');
      }
    }
  } else if ((match = ISO.exec(line))) {
    event.log_format = 'iso8601_text';
    event.timestamp = normalizeIso(match[1]);
    event.timestamp_source = event.timestamp ? 'embedded' : 'unknown';
  }

  if (event.event_type === 'unknown') {
    const lower = message.toLowerCase();
    if (lower.includes('failed password') || lower.includes('failed to log on')) {
      event.event_type = 'failed_login';
      event.severity = 'warning';
    } else if (lower.includes('accepted password') || lower.includes('successfully logged on')) {
      event.event_type = 'successful_login';
    } else if (lower.includes('invalid user')) {
      event.event_type = 'invalid_user';
      event.severity = 'warning';
    } else if (lower.includes('authentication failure')) {
      event.event_type = 'authentication_failure';
      event.severity = 'warning';
    }
  }

  if (!event.username) {
    const found = /(?:for|user)\s+(?:invalid user\s+)?([a-zA-Z0-9_.-]+)/.exec(message);
    if (found) event.username = found[1];
  }

  if (event.log_format === 'unknown') event.parse_warnings.push('Unrecognized log format');
  if (!event.timestamp) event.parse_warnings.push('Timestamp not parsed');
  if (event.event_type === 'unknown') event.parse_warnings.push('Event type not recognized');

  // Preserve source time and derive a sortable UTC instant.
  event.timestamp_utc = null;
  if (event.timestamp) {
    const utc = toUtcIso(event.timestamp);
    if (utc) event.timestamp_utc = utc;
    else event.parse_warnings.push('Cannot normalize timestamp to UTC');
  }

  /*
   * Compare the source clock against receipt time. A line cannot be written
   * after the server received it, so a timestamp later than receipt is proof
   * the source clock runs ahead. The reverse proves nothing on its own:
   * collected logs are normally older than the moment they arrive, so that
   * case is recorded as an observation and left for the device summary to
   * judge across a whole batch.
   */
  const receivedMs = epochMs(receivedAt);
  const claimedMs = epochMs(event.timestamp_utc);
  if (claimedMs !== null && receivedMs !== null) {
    const offset = Math.round((claimedMs - receivedMs) / 1000);
    event.clock_offset_seconds = offset;
    if (offset > CLOCK_TOLERANCE_SECONDS) event.clock_skew = 'ahead';
    else if (offset < -CLOCK_TOLERANCE_SECONDS) event.clock_skew = 'older_than_receipt';
    else event.clock_skew = 'within_tolerance';
  }

  // Expose exactly which fields could not be extracted.
  event.missing_fields = ['timestamp', 'event_type', 'log_format'].filter((field) =>
    field === 'timestamp' ? event[field] === null : event[field] === 'unknown',
  );
  event.parse_gap_count = event.parse_warnings.length;
  event.parse_status = event.parse_warnings.length === 0 ? 'complete' : 'partial';
  return event;
}

/**
 * A syslog line carries no year and no offset, so both are taken from the
 * receipt time as read in the source's own zone. Getting the zone wrong
 * shifts every one of these silently, which is why the agent is expected to
 * declare it rather than let the server assume.
 */
function inferSyslogTimestamp(stamp, receivedAt, sourceTimezone) {
  const receivedMs = epochMs(receivedAt);
  if (receivedMs === null) return null;

  const local = DateTime.fromMillis(receivedMs, { zone: sourceTimezone });
  if (!local.isValid) return null;

  const parts = /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(stamp);
  if (!parts) return null;
  const month = MONTHS[parts[1]];
  if (!month) return null;

  let inferred = DateTime.fromObject(
    {
      year: local.year, month, day: Number(parts[2]),
      hour: Number(parts[3]), minute: Number(parts[4]), second: Number(parts[5]),
    },
    { zone: sourceTimezone },
  );
  if (!inferred.isValid) return null;

  // A December line read in January belongs to the year before.
  if (local.month === 1 && inferred.month === 12 && inferred > local) {
    inferred = inferred.set({ year: inferred.year - 1 });
  }

  return {
    // Luxon writes a bare "Z" for UTC; Python's isoformat writes "+00:00".
    // The two are the same instant, but the stored text has to match, since
    // it is compared and displayed as a string elsewhere.
    timestamp: inferred.toISO({ suppressMilliseconds: true }).replace(/Z$/, '+00:00'),
    conflict: inferred > local,
  };
}
