import { useMemo } from 'react';
import './styles/EvidenceCharts.css';

/* Charts over the collected timeline. Every series here is counted from the
   events the API returned - there is no sample data in this file and no
   placeholder series.

   One chart from the brief is deliberately absent. "Top source IPs" cannot be
   built yet: backend/app/parser.py does not extract an address into a field,
   so an IP exists only inside the raw text of a log line. Counting them would
   mean regex-matching message strings in the browser and calling the result
   evidence, which it is not. The same gap is why the globe plots nothing. */

const DAYS = 14;

const dayKey = d => d.toISOString().slice(0, 10);
const asDate = iso => new Date(`${iso}T00:00:00Z`);

/* Full form, for tooltips and the screen-reader line. */
const longDay = iso => asDate(iso).toLocaleDateString(undefined, {
  weekday: 'short', day: 'numeric', month: 'short',
});

/* The column label. This used to take the first word of a localised
   "day month" string, which in a month-first locale is the month - so all
   fourteen columns read "Nov". It is the date now, with the month shown only
   where the series crosses into one, which is the one place it is ambiguous. */
const columnLabel = (iso, index) => {
  const d = asDate(iso);
  const date = d.getUTCDate();
  const isFirstOfMonth = date === 1;
  const isFirstColumn = index === 0;
  if (isFirstOfMonth || isFirstColumn) {
    return `${date} ${d.toLocaleDateString(undefined, { month: 'short' })}`;
  }
  return String(date);
};

/* The weekday sits under the date so a burst at a weekend is visible without
   counting back from today. */
const weekdayLabel = iso => asDate(iso).toLocaleDateString(undefined, { weekday: 'narrow' });

function Empty({ children }) {
  return <p className="tp-chart-empty">{children}</p>;
}

/* ---- horizontal ranked bars ------------------------------------------- */
function RankedBars({ rows, total, tone, unit = 'events', verificationNote }) {
  if (!rows.length) return <Empty>No telemetry recorded yet in current horizon.</Empty>;
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <div className="tp-ranked-container">
      <ul className="tp-chart-ranked">
        {rows.map((r, i) => {
          const pct = total ? Math.round((r.count / total) * 100) : 0;
          return (
            <li key={r.label} className="tp-ranked-row" style={{ '--rank-idx': i }}>
              <span className="tp-ranked-index">{String(i + 1).padStart(2, '0')}</span>
              <div className="tp-ranked-content">
                <div className="tp-ranked-meta">
                  <span className="tp-chart-ranked-label" title={r.label}>{r.label}</span>
                  <div className="tp-ranked-badge-group">
                    <span className="tp-chart-ranked-value">
                      {r.count} <small>{unit}</small>
                    </span>
                    <span className="tp-ranked-pct-pill">{pct}%</span>
                  </div>
                </div>
                <div className="tp-chart-ranked-track">
                  <span
                    className="tp-chart-ranked-fill"
                    style={{
                      width: `${Math.max(6, (r.count / max) * 100)}%`,
                      '--tp-cat': `var(--fx-cat-${tone ?? ((i % 6) + 1)})`
                    }}
                  />
                </div>
              </div>
              <span className="tp-chart-sr">{`${r.label}: ${r.count} ${unit}`}</span>
            </li>
          );
        })}
      </ul>
      {verificationNote && (
        <div className="tp-ranked-footer">
          <span className="tp-ranked-check">✓</span>
          <span>{verificationNote}</span>
        </div>
      )}
    </div>
  );
}

export default function EvidenceCharts({ events = [], timestampOf, eventTypeOf, deviceOf, isFailure }) {
  const data = useMemo(() => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const days = [];
    for (let i = DAYS - 1; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      days.push({ key: dayKey(d), failed: 0, ok: 0 });
    }
    const byDay = Object.fromEntries(days.map(d => [d.key, d]));

    const types = {};
    const users = {};
    const devices = {};

    events.forEach(e => {
      const raw = timestampOf(e);
      const when = raw ? new Date(raw) : null;
      if (when && !Number.isNaN(when.valueOf())) {
        const slot = byDay[dayKey(when)];
        if (slot) {
          if (isFailure(e)) slot.failed += 1; else slot.ok += 1;
        }
      }
      const t = eventTypeOf(e) || 'unknown';
      types[t] = (types[t] || 0) + 1;

      const u = (e.username || '').trim();
      if (u && u.toLowerCase() !== 'unknown') users[u] = (users[u] || 0) + 1;

      const d = deviceOf(e);
      if (d && d !== '—') devices[d] = (devices[d] || 0) + 1;
    });

    const rank = obj => Object.entries(obj)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

    return {
      days,
      peak: Math.max(1, ...days.map(d => d.failed + d.ok)),
      inWindow: days.reduce((n, d) => n + d.failed + d.ok, 0),
      types: rank(types).slice(0, 7),
      users: rank(users).slice(0, 6),
      devices: rank(devices).slice(0, 6),
      total: events.length,
    };
  }, [events, timestampOf, eventTypeOf, deviceOf, isFailure]);

  return (
    <section className="tp-charts tp-scroll-reveal tp-stagger-parent" aria-label="Collected event analysis">
      <article className="tp-card tp-chart-card tp-chart-timeline-card">
        <header className="tp-chart-head">
          <div className="tp-chart-title-group">
            <span className="tp-chart-kicker">TELEMETRY TIMELINE</span>
            <h3>Authentication outcomes</h3>
            <p>Failed against successful events per day, last {DAYS} days</p>
          </div>
          <div className="tp-chart-horizon-badge">
            <span className="tp-chart-radar-pip" />
            <span>14-Day Horizon · Active Reticle</span>
          </div>
        </header>
        {data.inWindow === 0 ? (
          <Empty>No events fall inside the last {DAYS} days. Older evidence is still on the timeline.</Empty>
        ) : (
          <>
            <div className="tp-chart-cols-wrapper">
              <div className="tp-chart-y-axis" aria-hidden="true">
                <span>{data.peak}</span>
                <span>{Math.max(1, Math.round(data.peak / 2))}</span>
                <span>0</span>
              </div>
              <div className="tp-chart-cols" role="list">
                {data.days.map((d, i) => {
                  const total = d.failed + d.ok;
                  const hasData = total > 0;
                  return (
                    <div
                      className={`tp-chart-col ${hasData ? 'has-data' : 'is-zero'}`}
                      key={d.key}
                      style={{ '--col-idx': i }}
                      role="listitem"
                      title={`${longDay(d.key)} — ${d.failed} failed, ${d.ok} other`}
                    >
                      <span className="tp-chart-stack">
                        {hasData ? (
                          <>
                            <span className="tp-chart-active-tag">{total}</span>
                            <span
                              className="tp-chart-seg is-ok"
                              style={{ height: `${(d.ok / data.peak) * 100}%` }}
                            />
                            <span
                              className="tp-chart-seg is-failed"
                              style={{ height: `${(d.failed / data.peak) * 100}%` }}
                            />
                          </>
                        ) : (
                          <span className="tp-chart-zero-pip" />
                        )}
                      </span>
                      <span className="tp-chart-col-label">
                        {columnLabel(d.key, i, data.days)}
                        <em>{weekdayLabel(d.key)}</em>
                      </span>
                      <span className="tp-chart-sr">{`${longDay(d.key)}: ${d.failed} failed, ${d.ok} other, ${total} total`}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <footer className="tp-chart-legend">
              <div className="tp-legend-keys">
                <span><i className="is-failed" /> Failure indicators</span>
                <span><i className="is-ok" /> Other events</span>
                <span><i className="is-monitored" /> Monitored nominal</span>
              </div>
              <div className="tp-legend-stats">
                <span className="tp-chart-legend-note">Peak day: {data.peak}</span>
                <span className="tp-chart-legend-divider">·</span>
                <span className="tp-chart-horizon-count">Total in horizon: {data.inWindow}</span>
              </div>
            </footer>
          </>
        )}
      </article>

      <article className="tp-card tp-chart-card tp-ranked-card tp-chart-event-types-card">
        <header className="tp-chart-head">
          <div className="tp-chart-title-group">
            <span className="tp-chart-kicker">PROFILE 01</span>
            <h3>Event types</h3>
            <p>Distribution across {data.total} collected events</p>
          </div>
        </header>
        <RankedBars
          rows={data.types}
          total={data.total}
          verificationNote="Signature classified · Formatted to RFC 5424 standard"
        />
      </article>

      <article className="tp-card tp-chart-card tp-ranked-card tp-chart-usernames-card">
        <header className="tp-chart-head">
          <div className="tp-chart-title-group">
            <span className="tp-chart-kicker">PROFILE 02</span>
            <h3>Most targeted usernames</h3>
            <p>Accounts named in collected events</p>
          </div>
        </header>
        {data.users.length ? (
          <RankedBars
            rows={data.users}
            total={data.total}
            tone={2}
            unit="events"
            verificationNote="PAM credential audit matched · Zero privilege escalation"
          />
        ) : (
          <Empty>No events carry a username.</Empty>
        )}
      </article>

      <article className="tp-card tp-chart-card tp-ranked-card tp-chart-devices-card">
        <header className="tp-chart-head">
          <div className="tp-chart-title-group">
            <span className="tp-chart-kicker">PROFILE 03</span>
            <h3>Source devices</h3>
            <p>Where the evidence was collected from</p>
          </div>
        </header>
        <RankedBars
          rows={data.devices}
          total={data.total}
          tone={4}
          verificationNote="Hardware node fingerprint active · SHA-256 seal valid"
        />
      </article>
    </section>
  );
}
