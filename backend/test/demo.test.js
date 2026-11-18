import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import * as demo from '../src/demo.js';
import { parseLog } from '../src/parser.js';

describe('Demo Date Shifting Layer', () => {
  it('newest line sits at the current moment', () => {
    const scenario = demo.DEMO_SCENARIOS.incident_01_ssh_bruteforce;
    const now = DateTime.fromObject(
      { year: 2027, month: 3, day: 8, hour: 7, minute: 15, second: 45 },
      { zone: 'Asia/Kolkata' }
    );

    const lines = demo.renderDemoLines(scenario, now);
    assert.ok(lines[lines.length - 1].startsWith('Mar 08 07:15:45'));
  });

  it('date follows the clock rather than the fixture', () => {
    const scenario = demo.DEMO_SCENARIOS.ssh_failures;

    const cases = [
      [
        DateTime.fromObject(
          { year: 2026, month: 11, day: 1, hour: 18, minute: 42, second: 9 },
          { zone: 'Asia/Kolkata' }
        ),
        'Nov 01',
      ],
      [
        DateTime.fromObject(
          { year: 2026, month: 12, day: 25, hour: 23, minute: 59, second: 30 },
          { zone: 'Asia/Kolkata' }
        ),
        'Dec 25',
      ],
      [
        DateTime.fromObject(
          { year: 2028, month: 2, day: 29, hour: 14, minute: 0, second: 0 },
          { zone: 'Asia/Kolkata' }
        ),
        'Feb 29',
      ],
    ];

    for (const [now, expected] of cases) {
      const rendered = demo.renderDemoLines(scenario, now);
      for (const line of rendered) {
        assert.ok(line.startsWith(expected), `Line "${line}" should start with "${expected}"`);
      }
    }
  });

  it('gaps between lines are preserved', () => {
    const scenario = demo.DEMO_SCENARIOS.incident_01_ssh_bruteforce;
    const now = DateTime.fromObject(
      { year: 2026, month: 11, day: 1, hour: 18, minute: 42, second: 9 },
      { zone: 'Asia/Kolkata' }
    );

    const rendered = demo.renderDemoLines(scenario, now);
    const events = rendered.map((line) =>
      parseLog(
        line,
        'demo-device-01',
        'test',
        scenario.log_type,
        now.toISO(),
        'Asia/Kolkata'
      )
    );

    const times = events.map((e) => DateTime.fromISO(e.timestamp_utc).toMillis());
    // The fixture burst runs 10:15:20 -> 10:24:00, so 8m40s = 520,000 ms end to end
    assert.equal(times[times.length - 1] - times[0], 520000);
  });

  it('cross timezone scenarios share one instant', () => {
    const now = DateTime.fromObject(
      { year: 2026, month: 11, day: 1, hour: 18, minute: 42, second: 9 },
      { zone: 'Asia/Kolkata' }
    );
    const instants = new Set();

    for (const key of ['tz_india', 'tz_london', 'tz_new_york', 'tz_linux_new_york']) {
      const scenario = demo.DEMO_SCENARIOS[key];
      const rendered = demo.renderDemoLines(scenario, now);
      for (const line of rendered) {
        const event = parseLog(
          line,
          'demo-device-01',
          'test',
          scenario.log_type,
          now.toISO(),
          scenario.source_timezone || 'Asia/Kolkata'
        );
        instants.add(event.timestamp_utc);
      }
    }

    assert.equal(instants.size, 1);
  });
});
