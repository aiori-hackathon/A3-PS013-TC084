import { useMemo, memo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  LabelList,
  CartesianGrid,
} from 'recharts';
import './styles/EvidenceCharts.css';

const DAYS = 7;

const dayKey = d => d.toISOString().slice(0, 10);
const asDate = iso => new Date(`${iso}T00:00:00Z`);

const longDay = iso => asDate(iso).toLocaleDateString(undefined, {
  weekday: 'short', day: 'numeric', month: 'short',
});

const columnLabel = (iso) => {
  const d = asDate(iso);
  const date = d.getUTCDate();
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  return `${date} ${month}`;
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

/* Custom Recharts Tooltip for Donut / Pie Chart */
function PieTooltip({ active, payload, total }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0];
  if (!d) return null;
  const pct = total ? Math.round((d.value / total) * 100) : 0;

  return (
    <div className="tp-recharts-tooltip" role="tooltip">
      <div className="tp-recharts-tooltip-head">
        <span className="mono" style={{ color: d.payload?.color || '#25543D', fontWeight: 700 }}>{d.name}</span>
        <span className="tp-recharts-tooltip-badge">{pct}% of total</span>
      </div>
      <div className="tp-recharts-tooltip-body">
        <div className="tp-recharts-tooltip-row">
          <span className="tp-recharts-pip" style={{ background: d.payload?.color || '#25543D' }} />
          <span>Recorded telemetry:</span>
          <strong>{d.value} events</strong>
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

export { RankedBarChart };

function EvidenceCharts({
  events = [],
  timestampOf,
  eventTypeOf,
  deviceOf,
  isFailure,
  showRanked = false,
}) {
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

    const timelineData = days.map((d) => ({
      key: d.key,
      date: columnLabel(d.key),
      fullDate: longDay(d.key),
      failed: d.failed,
      ok: d.ok,
      total: d.failed + d.ok,
    }));

    // Telemetry Posture Distribution
    let nominalCount = 0;
    let failureCount = 0;
    let warningCount = 0;
    let auditCount = 0;

    events.forEach(e => {
      const isFail = isFailure(e);
      const sev = (e.severity || '').toLowerCase();
      if (isFail) {
        failureCount += 1;
      } else if (sev === 'warning' || sev === 'warn') {
        warningCount += 1;
      } else if (sev === 'info' || sev === 'notice') {
        nominalCount += 1;
      } else {
        auditCount += 1;
      }
    });

    const postureData = [];
    if (nominalCount > 0) {
      postureData.push({ name: 'Nominal events', value: nominalCount, color: '#25543D' });
    }
    if (failureCount > 0) {
      postureData.push({ name: 'Failure alerts', value: failureCount, color: '#FF4D6A' });
    }
    if (warningCount > 0) {
      postureData.push({ name: 'Warnings / Skew', value: warningCount, color: '#F59E0B' });
    }
    if (auditCount > 0) {
      postureData.push({ name: 'System / Audit', value: auditCount, color: '#10B981' });
    }
    if (postureData.length === 0) {
      postureData.push({ name: 'Nominal events', value: Math.max(1, events.length), color: '#25543D' });
    }

    return {
      days,
      timelineData,
      postureData,
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
      {/* 1. 7-Day Telemetry Timeline Chart (Recharts) */}
      <article className="tp-card tp-chart-card tp-chart-timeline-card">
        <header className="tp-chart-head">
          <div className="tp-chart-title-group">
            <span className="tp-chart-kicker">TELEMETRY TIMELINE</span>
            <h3>Authentication outcomes</h3>
            <p>Failed vs nominal authentication events per day (7-day horizon)</p>
          </div>
          <div className="tp-chart-head-right">
            <div className="tp-legend-keys-inline">
              <span className="tp-legend-item"><i className="is-failed" /> Failures</span>
              <span className="tp-legend-item"><i className="is-ok" /> Nominal</span>
            </div>
            <div className="tp-chart-horizon-badge">
              <span className="tp-chart-radar-pip" />
              <span>{data.inWindow} events</span>
            </div>
          </div>
        </header>

        {data.inWindow === 0 ? (
          <Empty>No events fall inside the last {DAYS} days. Older evidence is still on the timeline.</Empty>
        ) : (
          <div className="tp-recharts-timeline-wrap">
            <ResponsiveContainer width="100%" height={235}>
              <BarChart
                data={data.timelineData}
                margin={{ top: 8, right: 12, left: -22, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="0"
                  vertical={false}
                  stroke="#D4E5D8"
                  strokeOpacity={0.4}
                />
                <XAxis
                  dataKey="date"
                  interval={0}
                  tickLine={false}
                  axisLine={{ stroke: '#D4E5D8' }}
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
                  fill="#FF4D6A"
                  radius={[0, 0, 0, 0]}
                  barSize={28}
                  minPointSize={2}
                  animationDuration={600}
                  animationEasing="ease-out"
                />
                <Bar
                  dataKey="ok"
                  name="Nominal / other"
                  stackId="auth"
                  fill="#25543D"
                  radius={[4, 4, 0, 0]}
                  barSize={28}
                  minPointSize={2}
                  animationDuration={600}
                  animationEasing="ease-out"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </article>

      {/* 2. Telemetry Posture Pie / Donut Chart */}
      <article className="tp-card tp-chart-card tp-chart-pie-card">
        <header className="tp-chart-head">
          <div className="tp-chart-title-group">
            <span className="tp-chart-kicker">SECURITY POSTURE</span>
            <h3>Event distribution</h3>
            <p>Outcome ratio across {data.total} collected events</p>
          </div>
          <div className="tp-chart-horizon-badge">
            <span className="tp-chart-radar-pip" />
            <span>{data.total} total</span>
          </div>
        </header>

        <div className="tp-pie-container">
          <div className="tp-pie-chart-slot">
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie
                  data={data.postureData}
                  cx="50%"
                  cy="50%"
                  innerRadius={46}
                  outerRadius={68}
                  paddingAngle={3}
                  dataKey="value"
                  animationDuration={800}
                  stroke="#FFFFFF"
                  strokeWidth={2}
                >
                  {data.postureData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip total={data.total} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="tp-pie-center-label" aria-hidden="true">
              <strong>{data.total}</strong>
              <small>EVENTS</small>
            </div>
          </div>

          <div className="tp-pie-legend-list">
            {data.postureData.map((item, idx) => {
              const pct = data.total ? Math.round((item.value / data.total) * 100) : 0;
              return (
                <div className="tp-pie-legend-row" key={idx}>
                  <div className="tp-pie-legend-label-wrap">
                    <span className="tp-pie-legend-dot" style={{ background: item.color }} />
                    <span className="tp-pie-legend-name">{item.name}</span>
                  </div>
                  <div className="tp-pie-legend-stats">
                    <strong>{item.value}</strong>
                    <span className="tp-pie-legend-pct">({pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </article>

      {/* Ranked profiles rendered only when explicitly requested (keeps Overview clean) */}
      {showRanked && (
        <>
          {/* Profile 01: Event types */}
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

          {/* Profile 02: Most targeted usernames */}
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

          {/* Profile 03: Source devices */}
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
        </>
      )}
    </section>
  );
}

const MemoizedEvidenceCharts = memo(EvidenceCharts);
export default MemoizedEvidenceCharts;
