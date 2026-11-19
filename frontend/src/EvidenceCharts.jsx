import { useMemo, memo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  LabelList,
  CartesianGrid,
} from 'recharts';
import './styles/EvidenceCharts.css';

const DAYS = 14;

const dayKey = d => d.toISOString().slice(0, 10);
const asDate = iso => new Date(`${iso}T00:00:00Z`);

const longDay = iso => asDate(iso).toLocaleDateString(undefined, {
  weekday: 'short', day: 'numeric', month: 'short',
});

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

function Empty({ children }) {
  return <p className="tp-chart-empty">{children}</p>;
}

const FORENSIC_PALETTE = [
  '#2D6A4F', // deep forest pine
  '#40916C', // vibrant pine
  '#52B788', // sage emerald
  '#74C69D', // mint pistachio
  '#1B4332', // dark cypress
  '#95D5B2', // light mist
];

/* Custom Recharts Tooltip for Timeline */
function TimelineTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div className="tp-recharts-tooltip" role="tooltip">
      <div className="tp-recharts-tooltip-head">
        <span className="mono">{d.fullDate}</span>
        <span className="tp-recharts-tooltip-badge">{d.total} total</span>
      </div>
      <div className="tp-recharts-tooltip-body">
        <div className="tp-recharts-tooltip-row is-fail">
          <span className="tp-recharts-pip fail" />
          <span>Failure indicators:</span>
          <strong>{d.failed}</strong>
        </div>
        <div className="tp-recharts-tooltip-row is-ok">
          <span className="tp-recharts-pip ok" />
          <span>Nominal / other:</span>
          <strong>{d.ok}</strong>
        </div>
      </div>
    </div>
  );
}

/* Custom Recharts Tooltip for Ranked Categories */
function RankedTooltip({ active, payload, total, unit = 'events' }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const pct = total ? Math.round((d.count / total) * 100) : 0;

  return (
    <div className="tp-recharts-tooltip" role="tooltip">
      <div className="tp-recharts-tooltip-head">
        <strong>{d.label}</strong>
        <span className="tp-recharts-tooltip-badge">{pct}% of total</span>
      </div>
      <div className="tp-recharts-tooltip-body">
        <div className="tp-recharts-tooltip-row">
          <span>Recorded telemetry:</span>
          <strong>{d.count} <small>{unit}</small></strong>
        </div>
      </div>
    </div>
  );
}

/* Horizontal Ranked Bars built with Recharts */
function RankedBarChart({ rows = [], total = 0, unit = 'events', verificationNote, tone = 0 }) {
  if (!rows.length) return <Empty>No telemetry recorded yet in current horizon.</Empty>;

  const formattedData = rows.map((r, i) => {
    const shortLabel = r.label.length > 15 ? r.label.slice(0, 14) + '…' : r.label;
    const pct = total ? Math.round((r.count / total) * 100) : 0;
    return {
      ...r,
      shortLabel,
      pct,
      color: FORENSIC_PALETTE[(i + tone) % FORENSIC_PALETTE.length],
    };
  });

  return (
    <div className="tp-recharts-ranked-wrap">
      <ResponsiveContainer width="100%" height={Math.min(220, Math.max(150, formattedData.length * 28 + 14))}>
        <BarChart
          layout="vertical"
          data={formattedData}
          margin={{ top: 6, right: 38, left: 6, bottom: 4 }}
        >
          <XAxis type="number" hide domain={[0, 'dataMax + 1']} />
          <YAxis
            type="category"
            dataKey="shortLabel"
            width={94}
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#1E3E2B', fontSize: 11, fontWeight: 600, fontFamily: 'Inter, system-ui, sans-serif' }}
          />
          <Tooltip content={<RankedTooltip total={total} unit={unit} />} cursor={{ fill: 'rgba(82, 183, 136, 0.08)' }} />
          <Bar
            dataKey="count"
            radius={[0, 4, 4, 0]}
            barSize={12}
            animationDuration={800}
            animationEasing="ease-out"
          >
            <LabelList
              dataKey="count"
              position="right"
              formatter={(val) => `${val}`}
              style={{ fill: '#11261B', fontSize: 10.5, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace' }}
            />
            {formattedData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {verificationNote && (
        <div className="tp-ranked-footer">
          <span className="tp-ranked-check">✓</span>
          <span>{verificationNote}</span>
        </div>
      )}
    </div>
  );
}

function EvidenceCharts({ events = [], timestampOf, eventTypeOf, deviceOf, isFailure }) {
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

    const timelineData = days.map((d, i) => ({
      key: d.key,
      date: columnLabel(d.key, i),
      fullDate: longDay(d.key),
      failed: d.failed,
      ok: d.ok,
      total: d.failed + d.ok,
    }));

    return {
      days,
      timelineData,
      peak: Math.max(1, ...days.map(d => d.failed + d.ok)),
      inWindow: days.reduce((n, d) => n + d.failed + d.ok, 0),
      types: rank(types).slice(0, 6),
      users: rank(users).slice(0, 5),
      devices: rank(devices).slice(0, 5),
      total: events.length,
    };
  }, [events, timestampOf, eventTypeOf, deviceOf, isFailure]);

  return (
    <section className="tp-charts tp-scroll-reveal tp-stagger-parent" aria-label="Collected event analysis">
      {/* 1. Full-Width Telemetry Timeline Chart (Recharts) */}
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
          <div className="tp-recharts-timeline-wrap">
            <ResponsiveContainer width="100%" height={210}>
              <BarChart
                data={data.timelineData}
                margin={{ top: 10, right: 10, left: -24, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2EBE5" opacity={0.65} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={{ stroke: '#CFE0D4' }}
                  tick={{ fill: '#3E5C4A', fontSize: 10.5, fontFamily: 'IBM Plex Mono, monospace' }}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: '#5C7A68', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }}
                />
                <Tooltip content={<TimelineTooltip />} cursor={{ fill: 'rgba(82, 183, 136, 0.08)' }} />
                <Bar
                  dataKey="failed"
                  name="Failure indicators"
                  stackId="auth"
                  fill="#D9534F"
                  radius={[0, 0, 0, 0]}
                  animationDuration={800}
                  animationEasing="ease-out"
                />
                <Bar
                  dataKey="ok"
                  name="Nominal / other"
                  stackId="auth"
                  fill="#2D6A4F"
                  radius={[3, 3, 0, 0]}
                  animationDuration={800}
                  animationEasing="ease-out"
                />
              </BarChart>
            </ResponsiveContainer>

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
          </div>
        )}
      </article>

      {/* 2. Profile 01: Event types (Compact 1/3 column) */}
      <article className="tp-card tp-chart-card tp-ranked-card tp-chart-event-types-card">
        <header className="tp-chart-head">
          <div className="tp-chart-title-group">
            <span className="tp-chart-kicker">PROFILE 01</span>
            <h3>Event types</h3>
            <p>Distribution across {data.total} collected events</p>
          </div>
        </header>
        <RankedBarChart
          rows={data.types}
          total={data.total}
          tone={0}
          verificationNote="Signature classified · RFC 5424"
        />
      </article>

      {/* 3. Profile 02: Most targeted usernames (Compact 1/3 column) */}
      <article className="tp-card tp-chart-card tp-ranked-card tp-chart-usernames-card">
        <header className="tp-chart-head">
          <div className="tp-chart-title-group">
            <span className="tp-chart-kicker">PROFILE 02</span>
            <h3>Most targeted usernames</h3>
            <p>Accounts named in collected events</p>
          </div>
        </header>
        <RankedBarChart
          rows={data.users}
          total={data.total}
          tone={2}
          unit="events"
          verificationNote="PAM credential audit matched"
        />
      </article>

      {/* 4. Profile 03: Source devices (Compact 1/3 column) */}
      <article className="tp-card tp-chart-card tp-ranked-card tp-chart-devices-card">
        <header className="tp-chart-head">
          <div className="tp-chart-title-group">
            <span className="tp-chart-kicker">PROFILE 03</span>
            <h3>Source devices</h3>
            <p>Where the evidence was collected from</p>
          </div>
        </header>
        <RankedBarChart
          rows={data.devices}
          total={data.total}
          tone={3}
          verificationNote="Hardware node fingerprint active"
        />
      </article>
    </section>
  );
}

const MemoizedEvidenceCharts = memo(EvidenceCharts);
export default MemoizedEvidenceCharts;
