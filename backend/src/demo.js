import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { parseLog } from './parser.js';
import { storeLogBatch } from './evidence.js';
import { currentUser } from './auth.js';

export const router = Router();

export const DEMO_FIXTURE_YEAR = 2026;

export const DEMO_SCENARIOS = {
  tz_india: {
    label: 'Time zones · India (Asia/Kolkata) · 10:30 IST',
    log_type: 'macos_unified',
    source_timezone: 'Asia/Kolkata',
    lines: ['2026-10-19 10:30:00.000000+0530 india-host sshd[1234]: Failed password for admin'],
  },
  tz_new_york: {
    label: 'Time zones · New York (America/New_York) · 01:00 EDT',
    log_type: 'windows_event',
    source_timezone: 'America/New_York',
    lines: [
      '{"EventID":4625,"TimeCreated":"2026-10-19T01:00:00-04:00","TargetUserName":"admin","Message":"An account failed to log on"}',
    ],
  },
  tz_london: {
    label: 'Time zones · London (Europe/London) · 06:00 BST',
    log_type: 'macos_unified',
    source_timezone: 'Europe/London',
    lines: ['2026-10-19 06:00:00.000000+0100 london-host sshd[1234]: Failed password for admin'],
  },
  tz_linux_new_york: {
    label: 'Time zones · Linux syslog (New York, inferred)',
    log_type: 'linux_syslog',
    source_timezone: 'America/New_York',
    lines: ['Oct 19 01:00:00 ny-linux sshd: Failed password for root'],
  },

  // Parsing gaps demo evidence
  parsing_mixed: {
    label: 'Parsing gaps · Mixed valid and problematic logs',
    log_type: 'linux_syslog',
    lines: [
      'Oct 19 10:15:20 linux-server sshd: Failed password for admin',
      'Oct 19 ??? linux-server sshd: Failed password for root',
      'Unrecognized security appliance record: code=XYZ action=blocked',
    ],
  },
  parsing_bad_json: {
    label: 'Parsing gaps · Malformed Windows JSON',
    log_type: 'windows_event',
    lines: ['{"EventID":4625,"TimeCreated":"2026-10-19T10:15:20Z","Message":"An account failed to log on"'],
  },
  parsing_missing_time: {
    label: 'Parsing gaps · Missing timestamp',
    log_type: 'linux_syslog',
    lines: ['sshd: Failed password for admin from 192.0.2.44'],
  },
  parsing_unknown_event: {
    label: 'Parsing gaps · Unknown macOS event',
    log_type: 'macos_unified',
    lines: ['2026-10-19 10:15:20.000000+0530 macbook securityd[123]: Unmapped policy code 739'],
  },
  linux_ssh: {
    label: 'Linux · Syslog SSH failures',
    log_type: 'linux_syslog',
    lines: [
      'Oct 19 10:15:20 linux-server sshd: Failed password for root from 192.0.2.10 port 50231 ssh2',
      'Oct 19 10:20:00 linux-server sshd: Accepted password for admin from 192.0.2.11 port 50232 ssh2',
    ],
  },
  windows_login: {
    label: 'Windows · Security Event Log (JSON export)',
    log_type: 'windows_event',
    lines: [
      '{"EventID":4625,"TimeCreated":"2026-10-19T10:15:20Z","Computer":"WIN-SERVER-01","TargetUserName":"admin","Message":"An account failed to log on"}',
      '{"EventID":4624,"TimeCreated":"2026-10-19T10:17:20Z","Computer":"WIN-SERVER-01","TargetUserName":"admin","Message":"An account was successfully logged on"}',
    ],
  },
  macos_ssh: {
    label: 'macOS · Unified Log text export',
    log_type: 'macos_unified',
    lines: [
      '2026-10-19 10:15:20.000000+0530 macbook sshd[1234]: Failed password for admin from 192.0.2.20 port 50500 ssh2',
      '2026-10-19 10:16:20.000000+0530 macbook sshd[1234]: Accepted password for admin from 192.0.2.20 port 50501 ssh2',
    ],
  },
  ssh_failures: {
    label: 'Legacy · Repeated SSH authentication failures',
    log_type: 'auth',
    lines: [
      'Oct 19 10:15:20 demo-server sshd: Failed password for root',
      'Oct 19 10:20:00 demo-server sshd: Failed password for admin',
      'Oct 19 10:21:10 demo-server sshd: Failed password for root',
    ],
  },
  ssh_success: {
    label: 'Legacy · Successful SSH authentication',
    log_type: 'auth',
    lines: ['Oct 19 10:24:00 demo-server sshd: Accepted password for admin'],
  },

  incident_01_ssh_bruteforce: {
    label: 'INCIDENT 01 · SSH failure burst followed by success (synthetic)',
    log_type: 'linux_syslog',
    source_timezone: 'Asia/Kolkata',
    lines: [
      'Oct 19 10:15:20 linux-server sshd: Failed password for root from 192.0.2.10 port 50231 ssh2',
      'Oct 19 10:20:00 linux-server sshd: Failed password for admin from 192.0.2.10 port 50232 ssh2',
      'Oct 19 10:21:10 linux-server sshd: Failed password for root from 192.0.2.10 port 50233 ssh2',
      'Oct 19 10:24:00 linux-server sshd: Accepted password for admin from 192.0.2.10 port 50234 ssh2',
    ],
  },
  incident_02_windows_lockout: {
    label: 'INCIDENT 02 · Windows failures and account lockout (synthetic)',
    log_type: 'windows_event',
    source_timezone: 'UTC',
    lines: [
      '{"EventID":4625,"TimeCreated":"2026-10-19T10:14:20Z","TargetUserName":"analyst","Message":"An account failed to log on"}',
      '{"EventID":4625,"TimeCreated":"2026-10-19T10:15:20Z","TargetUserName":"analyst","Message":"An account failed to log on"}',
      '{"EventID":4740,"TimeCreated":"2026-10-19T10:16:20Z","TargetUserName":"analyst","Message":"A user account was locked out"}',
      '{"EventID":4624,"TimeCreated":"2026-10-19T10:17:20Z","TargetUserName":"analyst","Message":"An account was successfully logged on"}',
    ],
  },
  incident_03_timezone_gaps: {
    label: 'INCIDENT 03 · Cross-timezone correlation and parsing gap (synthetic)',
    log_type: 'mixed_security',
    source_timezone: 'Asia/Kolkata',
    lines: [
      '2026-10-19 10:30:00.000000+0530 india-host sshd[1234]: Failed password for admin from 192.0.2.44 port 50300 ssh2',
      '{"EventID":4624,"TimeCreated":"2026-10-19T05:00:00Z","TargetUserName":"admin","Message":"An account was successfully logged on"}',
      '{"EventID":4625,"TimeCreated":"2026-10-19T05:02:00Z","TargetUserName":"admin","Message":"An account failed to log on"',
    ],
  },
};

const DEMO_MACOS = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+[+-]\d{4}/g;
const DEMO_ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})/g;
const DEMO_SYSLOG = /^[A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2}/;
const DEMO_SYSLOG_DATE = /^[A-Z][a-z]{2} +\d{1,2}/;

function demoTimezone(name) {
  if (name && DateTime.now().setZone(name).isValid) {
    return name;
  }
  return 'UTC';
}

function parseFixtureInstants(line, tz) {
  const found = [];

  // 1. Syslog (starts at line start)
  const syslogMatch = DEMO_SYSLOG.exec(line);
  if (syslogMatch) {
    const text = syslogMatch[0];
    const parts = /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(text);
    if (parts) {
      const monthNames = {
        Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
        Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
      };
      const month = monthNames[parts[1]];
      if (month) {
        const dt = DateTime.fromObject(
          {
            year: DEMO_FIXTURE_YEAR,
            month,
            day: Number(parts[2]),
            hour: Number(parts[3]),
            minute: Number(parts[4]),
            second: Number(parts[5]),
          },
          { zone: tz }
        );
        if (dt.isValid) {
          found.push({
            start: syslogMatch.index,
            end: syslogMatch.index + text.length,
            matchText: text,
            instant: dt,
            kind: 'syslog',
          });
        }
      }
    }
  }

  // 2. macOS
  DEMO_MACOS.lastIndex = 0;
  let m;
  while ((m = DEMO_MACOS.exec(line)) !== null) {
    const text = m[0];
    const dt = DateTime.fromISO(text.replace(' ', 'T'), { setZone: true });
    if (dt.isValid) {
      found.push({
        start: m.index,
        end: m.index + text.length,
        matchText: text,
        instant: dt,
        kind: 'macos',
      });
    }
  }

  // 3. ISO
  DEMO_ISO.lastIndex = 0;
  while ((m = DEMO_ISO.exec(line)) !== null) {
    const text = m[0];
    const dt = DateTime.fromISO(text, { setZone: true });
    if (dt.isValid) {
      found.push({
        start: m.index,
        end: m.index + text.length,
        matchText: text,
        instant: dt,
        kind: 'iso',
      });
    }
  }

  found.sort((a, b) => a.start - b.start);
  return found;
}

function formatDemoTimestamp(original, moment, kind, originalText) {
  if (kind === 'syslog' || DEMO_SYSLOG.test(original)) {
    return moment.toFormat('LLL dd HH:mm:ss');
  }

  if (kind === 'macos' || original.includes(' ')) {
    const offsetStr = moment.toFormat('ZZZ'); // e.g. +0530
    const secStr = moment.toFormat('yyyy-MM-dd HH:mm:ss');
    return `${secStr}.000000${offsetStr}`;
  }

  if (original.endsWith('Z')) {
    return moment.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
  }

  // ISO with offset
  const offset = moment.toFormat('ZZ'); // e.g. -04:00
  return `${moment.toFormat("yyyy-MM-dd'T'HH:mm:ss")}${offset}`;
}

export function renderDemoLines(scenario, frozenNow = null) {
  const tz = demoTimezone(scenario.source_timezone || 'Asia/Kolkata');
  const lines = scenario.lines || [];
  const parsed = lines.map((line) => parseFixtureInstants(line, tz));

  const allInstants = [];
  for (const list of parsed) {
    for (const item of list) {
      allInstants.push(item.instant);
    }
  }

  const anchor = (frozenNow || DateTime.now().setZone(tz))
    .toUTC()
    .set({ millisecond: 0 });

  if (allInstants.length === 0) {
    return lines.map((line) => {
      return line.replace(DEMO_SYSLOG_DATE, anchor.setZone(tz).toFormat('LLL dd'));
    });
  }

  let maxInstant = allInstants[0];
  for (const inst of allInstants) {
    if (inst.toMillis() > maxInstant.toMillis()) {
      maxInstant = inst;
    }
  }

  const shiftMs = anchor.toMillis() - maxInstant.toMillis();
  const rendered = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const found = parsed[i];

    // Right to left replacement
    const reversed = [...found].reverse();
    for (const item of reversed) {
      const moved = DateTime.fromMillis(item.instant.toMillis() + shiftMs, {
        zone: item.instant.zone,
      });
      const formatted = formatDemoTimestamp(item.matchText, moved, item.kind);
      line = line.slice(0, item.start) + formatted + line.slice(item.end);
    }

    if (found.length === 0) {
      line = line.replace(DEMO_SYSLOG_DATE, anchor.setZone(tz).toFormat('LLL dd'));
    }

    rendered.push(line);
  }

  return rendered;
}

const DemoIngestRequestSchema = z.object({
  scenario: z.string(),
});

router.get('/scenarios', (req, res) => {
  const items = Object.entries(DEMO_SCENARIOS).map(([key, value]) => ({
    id: key,
    label: value.label,
    device_id: 'demo-device-01',
    log_type: value.log_type,
    source_timezone: value.source_timezone || 'Asia/Kolkata',
    lines: renderDemoLines(value),
  }));
  return res.json({ items });
});

router.post('/ingest', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }

  if (req.headers['x-tracepoint-demo'] !== '1') {
    return res.status(400).json({ detail: 'Missing demo request header' });
  }

  const parsed = DemoIngestRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ detail: 'Invalid demo ingest request' });
  }

  const scenario = DEMO_SCENARIOS[parsed.data.scenario];
  if (!scenario) {
    return res.status(422).json({ detail: 'Unknown demo scenario' });
  }

  const lines = renderDemoLines(scenario);
  const batchId = crypto.randomUUID();
  const payloadObj = {
    device_id: 'demo-device-01',
    batch_id: batchId,
    log_type: scenario.log_type,
    source_timezone: scenario.source_timezone || 'Asia/Kolkata',
    lines,
  };

  const payloadBytes = Buffer.from(JSON.stringify(payloadObj), 'utf8');

  let stored;
  try {
    stored = storeLogBatch(payloadObj, payloadBytes, user.id);
  } catch (err) {
    return res.status(err.status || 500).json({ detail: err.message });
  }

  const events = lines.map((line, idx) => {
    const event = parseLog(
      line,
      payloadObj.device_id,
      batchId,
      payloadObj.log_type,
      stored.received_at,
      payloadObj.source_timezone
    );
    event.line_number = idx + 1;
    return event;
  });

  return res.status(201).json({ ...stored, events, demo: true });
});
