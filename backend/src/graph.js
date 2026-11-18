import { Router } from 'express';
import { currentUser } from './auth.js';
import { getTimelineForUser } from './evidence.js';
import { epochMs } from './isotime.js';

export const router = Router();

const FAILURES = new Set(['failed_login', 'invalid_user', 'authentication_failure']);
const WINDOW_SECONDS = 30 * 60;
const MAX_EVENTS = 1500;

export function parseMomentMs(event) {
  const value = event.timestamp_utc || event.timestamp;
  if (!value) return null;
  return epochMs(value);
}

export function buildGraph(events) {
  const nodes = [];
  const edges = [];
  const indexed = [];

  const consideredEvents = (events || []).slice(0, MAX_EVENTS);

  for (const event of consideredEvents) {
    const device = event.device_id;
    const batch = event.batch_id;
    const line = event.line_number;

    if (!device || !batch || typeof line !== 'number') {
      continue;
    }

    const identity = `${device}:${batch}:${line}`;
    const timeMs = parseMomentMs(event);
    const username = event.username;

    nodes.push({
      id: identity,
      device_id: device,
      batch_id: batch,
      line_number: line,
      username,
      timestamp: event.timestamp,
      timestamp_utc: event.timestamp_utc,
      event_type: event.event_type,
      severity: event.severity,
      parse_status: event.parse_status,
      parse_warnings: event.parse_warnings || [],
      timestamp_inferred: Boolean(event.timestamp_inferred),
      raw_log: event.raw_log,
    });

    if (
      timeMs !== null &&
      username &&
      (FAILURES.has(event.event_type) || event.event_type === 'successful_login')
    ) {
      indexed.push({
        timeMs,
        identity,
        userKey: String(username).toLowerCase(),
        device: String(device),
        eventType: event.event_type,
      });
    }
  }

  indexed.sort((a, b) => a.timeMs - b.timeMs);

  const byUser = new Map();
  for (const item of indexed) {
    if (!byUser.has(item.userKey)) byUser.set(item.userKey, []);
    byUser.get(item.userKey).push(item);
  }

  for (const [, group] of byUser.entries()) {
    for (let i = 0; i < group.length; i++) {
      const current = group[i];
      if (current.eventType !== 'successful_login') continue;

      const preceding = [];
      for (let j = i - 1; j >= 0; j--) {
        const earlier = group[j];
        const seconds = (current.timeMs - earlier.timeMs) / 1000;
        if (seconds > WINDOW_SECONDS) break;
        if (FAILURES.has(earlier.eventType)) {
          preceding.push(earlier);
        }
      }

      // preceding was collected in reverse order (closest first).
      // Python does: for earlier in reversed(preceding[-8:]):
      // Python's preceding had earlier appended in reverse order (closest first).
      // preceding[-8:] takes up to 8 items (the 8 furthest from current among those within window, or up to 8 total)
      // and reversed() puts them in ascending order of time!
      const slice = preceding.slice(0, 8).reverse();
      for (const earlier of slice) {
        const sameDevice = earlier.device === current.device;
        edges.push({
          source: earlier.identity,
          target: current.identity,
          type: 'failure_before_success',
          reason: sameDevice
            ? 'Same username and device within 30 minutes'
            : 'Same username across devices within 30 minutes; identity alone does not prove the events are related',
          confidence: sameDevice ? 'stronger' : 'tentative',
          seconds_apart: Math.round((current.timeMs - earlier.timeMs) / 1000),
        });
      }
    }
  }

  return {
    nodes,
    edges,
    total_events_considered: Math.min((events || []).length, MAX_EVENTS),
    truncated: (events || []).length > MAX_EVENTS,
    rules: [
      'Failed authentication followed by successful login for the same username within 30 minutes',
      'Same-device links are stronger; cross-device links are tentative',
      'Events without valid timestamps or usernames are not linked automatically',
    ],
    disclaimer: 'Correlations are investigative leads, not proof of compromise.',
  };
}

router.get('', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }

  const timeline = getTimelineForUser(user.id);
  return res.json(buildGraph(timeline.events || []));
});
