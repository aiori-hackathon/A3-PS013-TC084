// TRACEPOINT_SHADCN_PHASE2
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from './components/ui/table';
// TRACEPOINT_SHADCN_PHASE1
import { Card } from './components/ui/card';
import {
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { Wifi, WifiOff, Activity, ArrowDownToLine, ChevronRight, CircleHelp, Clock3, FileClock, FileText, Fingerprint, LayoutDashboard, LogOut, Menu, RefreshCw, Search, ShieldAlert, SlidersHorizontal, Terminal, X, GitBranch, BookOpen} from 'lucide-react';
import './styles/Tracepoint.css';
import './styles/TracepointTimelineGraphModal.css';
import './styles/TimelineWorkspace.css';
import './styles/TracepointInteractionPolish.css';
import './styles/TracepointPublicSector.css';
import './styles/TracepointWorkflowGuide.css';

import LazyPage from './LazyPage';
const InvestigationGraph = lazy(() => import('./InvestigationGraph'));
const Reports = lazy(() => import('./Reports'));
const Investigations = lazy(() => import('./Investigations'));
const EvidenceLibrary = lazy(() => import('./EvidenceLibrary'));
const LogIngestionLab = lazy(() => import('./LogIngestionLab'));

import './styles/TracepointOfficialPortal.css';
import './styles/TracepointEyeHero.css';
import './styles/TracepointEyeHeroFix.css';

import './styles/TracepointThemeContrast.css';
import './styles/TracepointResponsiveNavigation.css';
import './styles/TracepointDesktopCompactHeight.css';
// Imported last on purpose: this is the design system, and it has to win
// the cascade against the legacy sheets above while they are retired.
import './styles/forensic.css';
import TracepointMark from './TracepointMark';
import EvidenceGlobe from './EvidenceGlobe';
import EvidenceCharts from './EvidenceCharts';
const navigation = [
  ['overview', 'Overview', LayoutDashboard],
  ['timeline', 'Event timeline', Activity],
  ['ingestion', 'Log Ingestion Lab', Terminal],
  ['evidence', 'Evidence', Fingerprint],
  ['investigations', 'Investigations', ShieldAlert],
  ['graph', 'Investigation Graph', GitBranch],
  ['guide', 'Workflow Guide', BookOpen],
];
const text = value => value === undefined || value === null || value === '' ? '—' : String(value);
const timestamp = e => e.timestamp || e.event_timestamp || e.time || e.received_at || e.datetime || '';
const eventType = e => text(e.event_type || e.type || e.action || 'Event').replaceAll('_', ' ');
const severity = e => text(e.severity || e.level || 'unknown').toLowerCase();
const device = e => text(e.device_id || e.hostname || e.device || e.host);
// raw_log is the field the agent actually stores, and it was missing from this
// chain, so every agent-collected event fell through to the final fallback -
// eventType - and the table printed the same string twice on each row: "Failed
// Login" over "failed login". The eventType fallback is gone with it: a row
// with no message should say nothing, not repeat its own title.
const message = e => text(e.message || e.raw_log || e.raw_line || e.raw || e.description || e.details || '');
const dateLabel = value => { const d = new Date(value); return value && !Number.isNaN(d.getTime()) ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : text(value); };
const fullDate = value => { const d = new Date(value); return value && !Number.isNaN(d.getTime()) ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }) : text(value); };
const unpack = data => Array.isArray(data) ? data : (data?.events || data?.timeline || data?.items || data?.data?.events || []);
const csvValue = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
// The parser compares each source clock against the time this server received
// the line. A line dated after receipt proves the source clock is ahead; one
// dated before it only means the log was collected after the fact.
const clockDuration = seconds => seconds < 90 ? `${seconds}s` : seconds < 5400 ? `${Math.round(seconds / 60)} min` : `${(seconds / 3600).toFixed(1)} h`;
const clockLabel = e => {
  if (typeof e.clock_offset_seconds !== 'number') return 'Not comparable with receipt time';
  const amount = clockDuration(Math.abs(e.clock_offset_seconds));
  if (e.clock_skew === 'ahead') return `Source clock ahead of receipt by ${amount}`;
  if (e.clock_skew === 'older_than_receipt') return `Recorded ${amount} before receipt — normal for collected logs`;
  return `Within tolerance (${amount})`;
};
const fail = e => /fail|denied|invalid|reject/i.test([eventType(e), message(e)].join(' '));
/* Deliberately a positive match, not "an attempt that was not a failure".
   Subtracting failures from attempts would count every event whose outcome
   the log does not state as a success, which is the opposite of what the
   evidence says. An attempt that matches neither is counted as neither. */
const succeeded = e => !fail(e) && /accepted\s+(password|publickey)|session opened|authentication succeeded|login successful|successful login/i
  .test([eventType(e), message(e)].join(' '));
const severityClass = value => {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const canonical = normalized === 'informational' ? 'info' : normalized === 'warn' ? 'warning' : normalized;
  return `sev-${canonical || 'unknown'}`;
};

// Rolling window ending today. Demo fixtures are dated on ingest, so recent
// evidence lands inside it; widen CHART_DAYS to look further back.
const CHART_DAYS = 7;
function TrendChart({ events }) {
  const buckets = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Array.from({ length: CHART_DAYS }, (_, index) => {
      const day = new Date(today); day.setDate(today.getDate() - (CHART_DAYS - 1 - index));
      const next = new Date(day); next.setDate(day.getDate() + 1);
      const current = events.filter(e => { const time = Date.parse(timestamp(e)); return time >= day.getTime() && time < next.getTime(); });
      return { label: day.toLocaleDateString(undefined, { weekday: 'short' }), title: day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), total: current.length, failures: current.filter(fail).length };
    });
  }, [events]);
  const max = Math.max(1, ...buckets.map(b => b.total));
  return <section className="tp-card tp-chart-card"><div className="tp-card-head"><div><h2>Event activity</h2><p>Collected events over the last {CHART_DAYS} days</p></div><span className="tp-period">Last {CHART_DAYS} days</span></div><div className="tp-chart"><div className="tp-chart-lines"><span>{max}</span><span>{Math.round(max / 2)}</span><span>0</span></div><div className="tp-bars">{buckets.map((b, i) => <div className="tp-bar-column" key={i}><div className="tp-bar-track"><div className="tp-bar-stack" data-tooltip={`${b.title} \u00b7 Other events: ${Math.max(0, b.total - b.failures)}`} style={{ height: `${b.total ? Math.max(5, b.total / max * 100) : 0}%` }}><div className="tp-bar-failure" data-tooltip={`${b.title} \u00b7 Authentication failures: ${b.failures}`} style={{ height: `${b.total ? b.failures / b.total * 100 : 0}%` }} /></div></div><span>{b.label}</span></div>)}</div></div><div className="tp-legend"><span><i className="tp-key-purple"/> Other events</span><span><i className="tp-key-orange"/> Authentication failures</span></div></section>;
}
function SeverityCard({ events }) {
  const groups = ['critical', 'high', 'medium', 'warning', 'low', 'info', 'unknown'];
  const counts = groups.map(name => ({ name, count: events.filter(e => severity(e) === name || (name === 'info' && severity(e) === 'informational')).length }));
  const max = Math.max(1, ...counts.map(c => c.count));
  return <section className="tp-card tp-distribution"><div className="tp-card-head"><div><h2>Severity breakdown</h2><p>Classification of collected events</p></div></div><div className="tp-severity-list">{counts.map(c => <div className="tp-severity-row" key={c.name}><span className={`tp-sev-dot ${severityClass(c.name)}`}/><span className="tp-sev-label">{c.name}</span><div className="tp-sev-track"><div className={`tp-sev-fill ${severityClass(c.name)}`} style={{ width: `${c.count / max * 100}%` }}/></div><strong>{c.count}</strong></div>)}</div><div className="tp-distribution-foot">Based on event severity fields received from the agent</div></section>;
}
function Metric({ label, value, note, icon: Icon }) { return <Card className="tp-metric"><div className="tp-metric-label">{label}<Icon size={17}/></div><strong>{value}</strong><span>{note}</span></Card>; }
// TRACEPOINT_EVENT_TABLE_REDESIGN_V1
const eventIcon = e => {
  const name = eventType(e).toLowerCase();
  if (/fail|denied|invalid|reject/.test(name)) return ShieldAlert;
  if (/login|auth|session|access/.test(name)) return Fingerprint;
  if (/error|critical|alert/.test(name)) return ShieldAlert;
  return Activity;
};
const eventDateParts = value => {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return { date: text(value), time: '' };
  return {
    date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  };
};
function EventTable({ rows, loading, onSelect }) {
  return <div className="tp-table-scroll tp-event-table-redesign">
    <Table className="tp-table tp-forensic-table">
      <TableHeader><TableRow>
        <TableHead>Event</TableHead><TableHead>Source device</TableHead>
        <TableHead>User</TableHead><TableHead>Severity</TableHead>
        <TableHead>Timestamp</TableHead><TableHead aria-label="Inspect event" />
      </TableRow></TableHeader>
      <TableBody>{rows.map((e, i) => {
        const Icon = eventIcon(e);
        const when = eventDateParts(timestamp(e));
        const level = severity(e);
        return <TableRow
          key={`${e.id || e.event_id || timestamp(e)}-${i}`}
          onClick={() => onSelect(e)}
          onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(e); } }}
          tabIndex={0} role="button" aria-label={`Inspect ${eventType(e)} event`}
        >
          <TableCell className="tp-event-cell">
            <div className="tp-forensic-event-identity">
              <span className={`tp-forensic-event-icon ${fail(e) ? 'is-failure' : ''}`} aria-hidden="true"><Icon size={18}/></span>
              <span className="tp-forensic-event-text">
                <strong>{eventType(e)}</strong>
                {message(e) !== '—' && <small title={message(e)}>{message(e)}</small>}
              </span>
            </div>
          </TableCell>
          <TableCell><code className="tp-forensic-device">{device(e)}</code></TableCell>
          <TableCell><span className="tp-forensic-username">{text(e.username)}</span></TableCell>
          <TableCell><Badge variant="outline" className={`tp-severity ${severityClass(level)}`}>{level}</Badge></TableCell>
          <TableCell><time className="tp-forensic-event-time" dateTime={timestamp(e) || undefined}>
            <span>{when.date}</span>{when.time && <small>{when.time}</small>}
          </time></TableCell>
          <TableCell className="tp-forensic-open-cell"><ChevronRight size={17} aria-hidden="true"/></TableCell>
        </TableRow>;
      })}</TableBody>
    </Table>
    {loading && <div className="tp-empty">Loading events…</div>}
    {!loading && !rows.length && <div className="tp-empty">No events to display. Check your agent connection or adjust the filters.</div>}
  </div>;
}


function AnimatedCount({ value, animationKey }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const target = Math.max(0, Number(value) || 0);
    const duration = 2300;
    let start;
    let frame;

    const animate = now => {
      if (start === undefined) start = now;
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(Math.round(target * eased));

      if (progress < 1) {
        frame = requestAnimationFrame(animate);
      }
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [value, animationKey]);

  return <>{shown.toLocaleString()}</>;
}

/* The activity strip.

   This used to bucket into the last seven calendar days whatever the events
   said. On a workspace whose collection is concentrated in a few hours that
   drew one bar and six empty columns, and it quietly dropped every event
   older than a week - 408 collected, 389 charted - so the strip both looked
   broken and under-reported. It spans the collection's own range now: the
   first collected event to the last, split into equal buckets, so every
   event is on it and the shape is the real one.

   The range is stated next to the count, because "activity" over an
   unlabelled axis would otherwise look like a fixed window. */
/* NOT CURRENTLY MOUNTED. The timeline page renders the records straight
   after the toolbar; this strip was taking space from them. To put it back,
   add this one line above <TimelineExplorer> on the timeline page:

     {timelineReady && <TimelineActivityChart events={events} animationKey={timelineAnimationKey}/>}
*/
const STRIP_BUCKETS = 48;

function TimelineActivityChart({ events, animationKey }) {
  const data = useMemo(() => {
    const times = events
      .map(e => new Date(timestamp(e)).getTime())
      .filter(t => !Number.isNaN(t));

    if (!times.length) return null;

    const first = Math.min(...times);
    const last = Math.max(...times);
    /* A collection that lands inside one minute still needs a width to draw
       across, so a zero span is widened to a minute. */
    const span = Math.max(last - first, 60000);
    const step = span / STRIP_BUCKETS;

    const buckets = Array.from({ length: STRIP_BUCKETS }, () => ({ total: 0, failures: 0 }));
    events.forEach(e => {
      const t = new Date(timestamp(e)).getTime();
      if (Number.isNaN(t)) return;
      const i = Math.min(STRIP_BUCKETS - 1, Math.floor((t - first) / step));
      buckets[i].total += 1;
      if (fail(e)) buckets[i].failures += 1;
    });

    const charted = buckets.reduce((n, b) => n + b.total, 0);
    return { buckets, first: new Date(first), last: new Date(last), charted };
  }, [events]);

  if (!data) return null;

  const peak = Math.max(1, ...data.buckets.map(b => b.total));
  const stamp = d => d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <section className="tp-card tp-tl-activity" aria-label="Collected event activity over the collection range">
      <div className="tp-tl-activity-head">
        <span className="tp-tl-activity-title">Activity</span>
        <span className="tp-tl-activity-note">
          {data.charted.toLocaleString()} events · {stamp(data.first)} – {stamp(data.last)}
        </span>
      </div>

      <div className="tp-tl-activity-plot">
        {data.buckets.map((b, index) => (
          <div
            className="tp-tl-activity-col"
            key={index}
            title={`${b.total} events, ${b.failures} matching failure indicators`}
          >
            <span className="tp-tl-activity-track">
              <span
                className="tp-tl-activity-bar"
                style={{
                  /* A bucket with events never rounds away, but an empty one
                     stays empty: a permanent stub would read as activity that
                     was not collected. */
                  height: `${b.total ? Math.max(6, (b.total / peak) * 100) : 0}%`,
                  '--bar-delay': `${Math.min(index, 24) * 12}ms`
                }}
              >
                {b.failures > 0 && (
                  <span
                    className="tp-tl-activity-fail"
                    style={{ height: `${(b.failures / b.total) * 100}%` }}
                  />
                )}
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ===========================================================================
   THE TIMELINE EXPLORER
   ---------------------------------------------------------------------------
   Three panels: where the evidence came from, what happened there, and the
   record you are looking at.

   Every number is counted from the events the API already returned, so the
   panels cannot disagree with each other or with the table they replaced.
   Nothing here infers anything the records do not say: an event with no
   username is grouped under "unknown" rather than dropped or attributed to
   an account, and an event with an unreadable timestamp is grouped under
   "undated" rather than being given a date that would place it in the wrong
   day.
   =========================================================================== */

/* An authentication attempt, judged from the event type alone. Deliberately
   narrower than `fail`, which also reads the message text: this one decides
   whether an event is an attempt at all, and the message of an unrelated
   event can easily contain the word "user". */
const isAuthAttempt = e => /login|logon|auth|password|credential|invalid user|session/i.test(eventType(e));

const UNDATED = 'undated';

const dayKeyOf = value => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return UNDATED;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const dayTitle = date => date
  ? date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  : 'Events without a readable timestamp';

const dayShort = date => date
  ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  : 'Undated';

/* The clock time and its zone, split so the row can set them on two lines.
   The zone is shown on every row because the records carry UTC and the page
   renders local time - leaving it off would make the two look interchangeable. */
const timeParts = value => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return ['—', ''];
  const t = d.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const z = d.toLocaleTimeString(undefined, { timeZoneName: 'short' }).split(' ').slice(1).join(' ');
  return [t, z];
};

function TimelineExplorer({ events, loading, onInspect }) {
  const [scope, setScope] = useState(null);
  const [dayPick, setDayPick] = useState(null);
  const [pick, setPick] = useState(null);
  /* Which devices are expanded. Unset means "follow the selection", so the
     host you are looking at is open and the others are folded away rather
     than every account on every host being listed at once. */
  const [openDevices, setOpenDevices] = useState({});

  /* device -> usernames, both read straight off the records. */
  const sources = useMemo(() => {
    const devices = new Map();
    events.forEach(e => {
      const id = device(e);
      if (!devices.has(id)) devices.set(id, { id, total: 0, users: new Map() });
      const node = devices.get(id);
      node.total += 1;
      const user = (e.username || '').trim() || 'unknown';
      node.users.set(user, (node.users.get(user) || 0) + 1);
    });
    return [...devices.values()]
      .sort((a, b) => b.total - a.total)
      .map(node => ({
        ...node,
        users: [...node.users.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => a.name.localeCompare(b.name))
      }));
  }, [events]);

  /* Derived rather than stored, so a scope that the current search has
     filtered away falls back to a real one instead of emptying the page. */
  const active = (scope && sources.some(s => s.id === scope.device)) ? scope
    : (sources[0] ? { device: sources[0].id, username: null } : null);

  const scoped = useMemo(() => {
    if (!active) return [];
    return events.filter(e =>
      device(e) === active.device &&
      (!active.username || ((e.username || '').trim() || 'unknown') === active.username));
  }, [events, active?.device, active?.username]);

  const days = useMemo(() => {
    const map = new Map();
    scoped.forEach(e => {
      const key = dayKeyOf(timestamp(e));
      if (!map.has(key)) {
        const d = new Date(timestamp(e));
        map.set(key, { key, date: Number.isNaN(d.getTime()) ? null : d, count: 0 });
      }
      map.get(key).count += 1;
    });
    return [...map.values()].sort((a, b) => {
      if (a.key === UNDATED) return 1;
      if (b.key === UNDATED) return -1;
      return b.key.localeCompare(a.key);
    });
  }, [scoped]);

  const activeDay = days.find(d => d.key === dayPick) || days[0] || null;

  /* Ascending, so the day reads as it happened. */
  const rows = useMemo(() => {
    if (!activeDay) return [];
    return scoped
      .filter(e => dayKeyOf(timestamp(e)) === activeDay.key)
      .sort((a, b) => new Date(timestamp(a)) - new Date(timestamp(b)));
  }, [scoped, activeDay?.key]);

  /* Only marks which row is highlighted. The record itself is read in the
     detail window, which the page owns. */
  const current = rows.includes(pick) ? pick : null;

  /* The donut under the sources tree. Counted from the events in the current
     selection, so it answers "what is this host/account made of" rather than
     repeating the page totals. Five named types plus a grouped remainder:
     past that the slices are too thin to read and the legend stops fitting. */
  const mix = useMemo(() => {
    const counts = {};
    scoped.forEach(e => { const t = eventType(e) || 'unknown'; counts[t] = (counts[t] || 0) + 1; });
    const ranked = Object.entries(counts).map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
    const top = ranked.slice(0, 5);
    const rest = ranked.slice(5).reduce((n, r) => n + r.count, 0);
    if (rest > 0) top.push({ label: 'Other types', count: rest });
    return { slices: top, total: scoped.length };
  }, [scoped]);

  const isOpen = id => openDevices[id] !== undefined ? openDevices[id] : active?.device === id;

  /* One control, two jobs: picking a different host selects it and opens it;
     clicking the host you are already on folds it up again. */
  function toggleDevice(id) {
    const wasActive = active?.device === id && !active?.username;
    setScope({ device: id, username: null });
    setDayPick(null);
    setPick(null);
    setOpenDevices(o => ({ ...o, [id]: wasActive ? !isOpen(id) : true }));
  }

  const attempts = rows.filter(isAuthAttempt);
  const failed = attempts.filter(fail);
  const passed = attempts.filter(succeeded);
  /* Attempts whose outcome the log does not state. Shown only when there are
     some, so the row does not carry a permanent zero. */
  const unstated = attempts.length - failed.length - passed.length;

  if (loading) return <div className="tp-card tp-tl-grid-empty">Loading collected events…</div>;
  if (!active) return <div className="tp-card tp-tl-grid-empty">No events match the current search.</div>;

  const deviceCount = sources.length;

  return (
    <div className="tp-tl-grid">
      {/* ---- where the evidence came from ---------------------------------- */}
      <div className="tp-tl-side">
      <aside className="tp-card tp-tl-sources" aria-label="Investigation sources">
        <div className="tp-tl-panel-head">
          <span>Investigation sources</span>
          <span className="tp-tl-panel-count">
            <strong>{deviceCount}</strong> {deviceCount === 1 ? 'device' : 'devices'}
          </span>
        </div>
        <div className="tp-tl-tree">
          {sources.map(node => (
            <div className="tp-tl-tree-group" key={node.id}>
              <button
                type="button"
                className="tp-tl-tree-device"
                aria-expanded={isOpen(node.id)}
                data-active={active.device === node.id && !active.username ? '' : undefined}
                onClick={() => toggleDevice(node.id)}
              >
                <span className="tp-tl-tree-caret" aria-hidden="true" />
                <span className="tp-tl-tree-dot" aria-hidden="true" />
                <span className="tp-tl-tree-name">{node.id}</span>
                <span className="tp-tl-tree-count">{node.total}</span>
              </button>
              {isOpen(node.id) && node.users.map(user => (
                <button
                  type="button"
                  className="tp-tl-tree-user"
                  key={user.name}
                  aria-pressed={active.device === node.id && active.username === user.name}
                  data-active={active.device === node.id && active.username === user.name ? '' : undefined}
                  onClick={() => { setScope({ device: node.id, username: user.name }); setDayPick(null); setPick(null); }}
                >
                  <span className="tp-tl-tree-branch" aria-hidden="true">↳</span>
                  <span className="tp-tl-tree-name">{user.name}</span>
                  <span className="tp-tl-tree-count">{user.count}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      {/* The composition of whatever is selected. */}
      <aside className="tp-card tp-tl-mix" aria-label="Event type breakdown">
        <div className="tp-tl-panel-head"><span>Event mix</span></div>
        {!mix.total && <p className="tp-tl-inspector-empty">Nothing in this selection.</p>}
        {mix.total > 0 && (
          <div className="tp-tl-mix-body">
            <svg className="tp-tl-donut" viewBox="0 0 132 132" role="img"
                 aria-label={`${mix.total} events across ${mix.slices.length} event types`}>
              <g transform="translate(66,66) rotate(-90)">
                {(() => {
                  const R = 52, C = 2 * Math.PI * R;
                  let offset = 0;
                  return mix.slices.map((sl, i) => {
                    const len = (sl.count / mix.total) * C;
                    const node = (
                      <circle key={sl.label} r={R} fill="none" strokeWidth="19"
                        style={{ stroke: `var(--fx-cat-${(i % 6) + 1})` }}
                        strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} />
                    );
                    offset += len;
                    return node;
                  });
                })()}
              </g>
              <text className="tp-tl-donut-total" x="66" y="64" textAnchor="middle">{mix.total.toLocaleString()}</text>
              <text className="tp-tl-donut-label" x="66" y="80" textAnchor="middle">events</text>
            </svg>
            <ul className="tp-tl-mix-legend">
              {mix.slices.map((sl, i) => (
                <li key={sl.label}>
                  <i style={{ background: `var(--fx-cat-${(i % 6) + 1})` }} aria-hidden="true" />
                  <span title={sl.label}>{sl.label}</span>
                  <strong>{sl.count}</strong>
                  <small>{Math.round((sl.count / mix.total) * 100)}%</small>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
      </div>

      {/* ---- what happened there ------------------------------------------- */}
      <section className="tp-card tp-tl-stream" aria-label="Activity stream">
        <div className="tp-tl-panel-head">
          <span>Activity stream</span>
        </div>

        <div className="tp-tl-stream-head">
          <div>
            <h3>{active.username || active.device}</h3>
            <p>{active.device} · {scoped.length.toLocaleString()} collected {scoped.length === 1 ? 'event' : 'events'}</p>
          </div>
          <div className="tp-tl-stream-count">
            <strong>{activeDay ? activeDay.count : 0}</strong>
            <small>events on selected day</small>
          </div>
        </div>

        {days.length > 1 && (
          <div className="tp-tl-days" role="tablist" aria-label="Dates with collected events">
            {days.map(d => (
              <button
                type="button"
                role="tab"
                key={d.key}
                className="tp-tl-day"
                aria-selected={activeDay?.key === d.key}
                data-active={activeDay?.key === d.key ? '' : undefined}
                onClick={() => { setDayPick(d.key); setPick(null); }}
              >
                <strong>{dayShort(d.date)}</strong>
                <small>{d.count}</small>
              </button>
            ))}
          </div>
        )}

        {activeDay && (
          <div className="tp-tl-daystats">
            <div><span>Login attempts</span><strong>{attempts.length}</strong></div>
            <div><span>Failed</span><strong className="is-fail">{failed.length}</strong></div>
            <div><span>Successful</span><strong className="is-ok">{passed.length}</strong></div>
            {unstated > 0 && <div><span>Outcome not stated</span><strong>{unstated}</strong></div>}
            <span className="tp-tl-daystats-date">{dayTitle(activeDay.date)}</span>
          </div>
        )}

        <ul className="tp-tl-rows">
          {rows.map((e, i) => {
            const [t, zone] = timeParts(timestamp(e));
            const level = severity(e);
            const chosen = e === current;
            return (
              <li key={`${timestamp(e)}-${i}`}>
                <button
                  type="button"
                  className="tp-tl-row"
                  data-active={chosen ? '' : undefined}
                  aria-current={chosen ? 'true' : undefined}
                  onClick={() => { setPick(e); onInspect?.(e); }}
                >
                  <span className="tp-tl-row-time"><strong>{t}</strong><small>{zone}</small></span>
                  <span className={`tp-tl-row-dot ${severityClass(level)}`} aria-hidden="true" />
                  <span className="tp-tl-row-body">
                    <strong>{eventType(e)}</strong>
                    <small>{message(e)}</small>
                  </span>
                  <span className="tp-tl-row-tags">
                    {fail(e) && <span className="tp-tl-tag is-fail">failed login</span>}
                    <span className={`tp-tl-tag ${severityClass(level)}`}>{level}</span>
                  </span>
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              </li>
            );
          })}
          {!rows.length && <li className="tp-tl-rows-empty">No events for this selection.</li>}
        </ul>

        <p className="tp-tl-stream-foot">
          Collected records are evidence. Patterns are investigative leads, not confirmed incidents.
        </p>
      </section>

    </div>
  );
}

export default function Dashboard({ user, onSignOut }) {
  // TRACEPOINT_PAGE_PERSIST_V1: remember the selected page for this tab.
  const [page, setPage] = useState(() => {
    try {
      const saved = window.sessionStorage.getItem('tracepoint.activePage');
      return navigation.some(([id]) => id === saved) ? saved : 'overview';
    } catch {
      return 'overview';
    }
  });
  const [events, setEvents] = useState([]);
  const initialPageRef = useRef(page);
  const initialTimelineLoadRef = useRef(null);
  const [timelineReady, setTimelineReady] = useState(false);
  const [timelineAnimationKey, setTimelineAnimationKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('all');
  const [selected, setSelected] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  // TRACEPOINT_FORENSIC_V1: the app ships in one appearance, and this value is
  // the switch that selects it. The legacy stylesheets scope 368 rules to
  // [data-theme="light"] and 933 to [data-theme="dark"]; naming the theme
  // something neither of them matches retires all 1301 at once, without
  // deleting a sheet that also carries layout. forensic.css then styles the
  // app unopposed. Retiring those sheets properly is follow-up work; until
  // then, setting this back to 'light' restores the old appearance exactly.
  const theme = 'forensic';
  useEffect(() => {
    // Clear the saved choice, or anyone who left the app in dark mode keeps a
    // key that would silently take effect if the toggle ever came back.
    try { window.localStorage.removeItem('tracepoint.theme'); } catch { /* storage unavailable */ }
  }, []);
  const [evidenceRefresh, setEvidenceRefresh] = useState(0);
  // TRACEPOINT_NAV_V2_STATUS: real API health check, every 30 seconds.
  const [apiStatus, setApiStatus] = useState('checking');
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const response = await fetch('/health', { cache: 'no-store' });
        if (active) setApiStatus(response.ok ? 'online' : 'offline');
      } catch { if (active) setApiStatus('offline'); }
    };
    check();
    const timer = setInterval(check, 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  // A quiet refresh skips the loading skeleton. Returning to the tab should
  // leave the page looking the same until the newer events simply appear.
  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/v1/timeline', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(response.status === 401 ? 'Your session has expired. Sign out and sign in again.' : `Unable to load events (HTTP ${response.status}).`);
      setEvents(unpack(await response.json()));
    } catch (err) { setError(err.message); } finally { if (!quiet) setLoading(false); }
  }, []);
  useEffect(() => {
    const request = refresh();
    if (initialPageRef.current === 'timeline') {
      initialTimelineLoadRef.current = request;
    }
  }, [refresh]);

  // Fetch fresh records once on each entry to Event Timeline.
  useEffect(() => {
    if (page !== 'timeline') {
      setTimelineReady(false);
      return;
    }

    let active = true;

    // Start the counters immediately; fetch fresh records in parallel.
    setTimelineReady(true);
    setTimelineAnimationKey(key => key + 1);

    const isInitialTimeline = initialPageRef.current === 'timeline';
    initialPageRef.current = null;

    const request = isInitialTimeline
      ? (initialTimelineLoadRef.current || refresh({ quiet: true }))
      : refresh({ quiet: true });

    Promise.resolve(request).catch(() => {
      // refresh() already handles and displays its own errors.
    });

    return () => {
      active = false;
    };
  }, [page, refresh]);

  // TRACEPOINT_REFRESH_ON_RETURN_V1: log collection happens in a terminal while
  // the browser sits in the background, so coming back to the tab re-reads the
  // timeline and the evidence library. This refetches data rather than reloading
  // the document, which would throw away the open case, filters and scroll.
  const lastRefreshRef = useRef(Date.now());
  useEffect(() => {
    const MIN_GAP_MS = 3000;
    const refetch = () => {
      if (document.visibilityState !== 'visible') return;
      // Switching apps fires focus and visibilitychange together, and flicking
      // away and back should not cost two round trips either.
      if (Date.now() - lastRefreshRef.current < MIN_GAP_MS) return;
      lastRefreshRef.current = Date.now();
      refresh({ quiet: true });
      setEvidenceRefresh(v => v + 1);
    };
    document.addEventListener('visibilitychange', refetch);
    window.addEventListener('focus', refetch);
    return () => {
      document.removeEventListener('visibilitychange', refetch);
      window.removeEventListener('focus', refetch);
    };
  }, [refresh]);
  const sorted = useMemo(() => [...events].sort((a, b) => (Date.parse(timestamp(b)) || 0) - (Date.parse(timestamp(a)) || 0)), [events]);
  const levels = useMemo(() => [...new Set(events.map(severity))].sort(), [events]);
  const filtered = useMemo(() => sorted.filter(e => (level === 'all' || severity(e) === level) && [eventType(e), device(e), message(e), e.username, timestamp(e)].some(v => text(v).toLowerCase().includes(search.trim().toLowerCase()))), [sorted, level, search]);
  // TRACEPOINT_OVERVIEW_REDESIGN_V1: all signals are derived from actual timeline events.
  const parsingIssues = events.filter(e => e.parse_status && !['parsed', 'success', 'ok', 'complete'].includes(String(e.parse_status).toLowerCase()) || Number(e.parse_gap_count || 0) > 0).length;
  const timestampIssues = events.filter(e => e.timestamp_conflict === true || e.timestamp_inferred === true).length;
  const clockAhead = events.filter(e => e.clock_skew === 'ahead').length;
  const affectedDevices = new Set(events.filter(fail).map(device).filter(d => d !== '—')).size;
  const failures = events.filter(fail).length;
  const devices = new Set(events.map(device).filter(d => d !== '—')).size;
  const users = new Set(events.map(e => e.username).filter(Boolean)).size;
  const title = navigation.find(item => item[0] === page)?.[1] || 'Overview';
  function exportCsv() {
    const rows = [['timestamp', 'event_type', 'severity', 'device_id', 'username', 'message'], ...filtered.map(e => [timestamp(e), eventType(e), severity(e), device(e), e.username || '', message(e)])];
    const csv = '\ufeff' + rows.map(row => row.map(csvValue).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'tracepoint-events.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const openPage = id => {
    setPage(id);
    try { window.sessionStorage.setItem('tracepoint.activePage', id); } catch { /* storage unavailable */ }
    setSelected(null);
    setMobileOpen(false);
  };
  return <div className="tp-app" data-theme={theme} data-page={page}>
    {/* TRACEPOINT_PUBLIC_PORTAL_LAYOUT_V1: formal utility strip */}
    <div className="tp-public-utility-bar">
      <div className="tp-public-utility-label"><strong>TRACEPOINT</strong><span>/</span><span>Cyber Incident Investigation Workspace</span></div>
      <div className="tp-public-utility-state" role="status"><span className={`tp-public-utility-dot ${apiStatus === 'online' ? 'is-online' : apiStatus === 'offline' ? 'is-offline' : ''}`} aria-hidden="true" />{apiStatus === 'online' ? 'API connection available' : apiStatus === 'offline' ? 'API connection unavailable' : 'Checking API connection'}<span>·</span><span>Hackathon prototype</span></div>
    </div>

    <aside className={`tp-sidebar ${mobileOpen ? 'tp-open' : ''}`}>
      <div className="tp-brand"><TracepointMark size={30} className="tp-brand-mark" /><span className="tp-brand-word">Tracepoint<span>.</span></span></div>
      <div className="tp-workspace"><span className="tp-workspace-avatar">TP</span><div><strong>Security workspace</strong><small>Evidence & investigations</small></div></div>
      <div className="tp-nav-label">Workspace</div>
      <nav aria-label="Main navigation">{navigation.map(([id, label, Icon]) => <button key={id} className={`tp-nav-item ${page === id ? 'active' : ''}`} onClick={() => openPage(id)}><Icon size={18}/><span>{label}</span>{page === id && <ChevronRight size={15} className="tp-nav-chevron"/>}</button>)}</nav>
      <div className="tp-sidebar-bottom">
        <div className={`tp-api-pill ${apiStatus}`} title={`Backend connection: ${apiStatus}`} role="status">
          {apiStatus === 'offline' ? <WifiOff size={14}/> : <Wifi size={14}/>}
          <span>{apiStatus === 'online' ? 'API connected' : apiStatus === 'offline' ? 'API offline' : 'Connecting…'}</span>
        </div>
        <div className="tp-profile">
          <span className="tp-profile-avatar">{(user?.name || 'U')[0].toUpperCase()}</span>
          <div className="tp-profile-details">
            <strong>{user?.name || 'Account'}</strong>
            <small>{user?.email || 'Analyst workspace'}</small>
          </div>
        </div>
        <button className="tp-signout" onClick={onSignOut} aria-label="Sign out" title="Sign out">
          <LogOut size={17}/> <span className="tp-signout-label">Sign out</span>
        </button>
      </div>
    </aside>
    <main className="tp-main">
    {/* TRACEPOINT_SINGLE_NAV_V1: status and account live in primary navigation */}

      <div className="tp-content"><div className={`tp-page-header ${page === 'guide' ? 'tp-page-header-guide' : ''}`}><div><h1>{title}</h1><p>{page === 'overview' ? 'Security activity and collected evidence across your workspace.' : page === 'timeline' ? 'Explore, filter and inspect security events.' : page === 'ingestion' ? 'Explore sample logs and follow them through the ingestion pipeline.' : page === 'evidence' ? 'Evidence collection and integrity records.' : page === 'graph' ? 'Explore evidence-linked authentication sequences.' : page === 'investigations' ? 'Review events and prepare incident investigations.' : page === 'guide' ? 'Follow the workflow from raw log ingestion to an incident report.' : 'Export collected security activity.'}</p></div><div className="tp-actions">
          <Button variant="outline" className="tp-button" onClick={() => {
{page === 'ingestion' && (
  <LazyPage name="Log Ingestion Lab">
    <LogIngestionLab
      onIngested={() => {
        refresh();
        setEvidenceRefresh(v => v + 1);
      }}
      onViewTimeline={() => openPage('timeline')}
    />
  </LazyPage>
)}

{page === 'investigations' && (
  <LazyPage name="Investigations">
    <Investigations events={events} />
  </LazyPage>
)}

{page === 'graph' && (
  <LazyPage name="Investigation Graph">
    <div className="tp-graph-page">
      <InvestigationGraph theme={theme} />
    </div>
  </LazyPage>
)}

{page === 'reports' && (
  <LazyPage name="Reports">
    <div className="tp-reports-page">
      <Reports onExportCsv={exportCsv} />
    </div>
  </LazyPage>
)}
}} disabled={loading}><RefreshCw size={16} className={loading ? 'tp-spin' : ''}/> Refresh</Button>{page === 'timeline' && <Button className="tp-button primary" onClick={exportCsv}><ArrowDownToLine size={16}/> Export CSV</Button>}</div></div>
      {error && <div className="tp-error" role="alert">{error}</div>}
      {page === 'overview' && <>
      <div className="tp-forensic-intro">
        {/* Replaces the decorative eye artwork. It plots nothing today, and
            says so: see the note at the top of EvidenceGlobe.jsx. */}
        <EvidenceGlobe
          events={events}
          severityOf={severity}
          deviceOf={device}
          isFailure={fail}
          timestampOf={timestamp}
        />
        <div className="tp-forensic-intro-copy">
          <span className="tp-forensic-kicker"><Activity size={14}/> LIVE EVIDENCE OVERVIEW</span>
          <strong>Follow the signal. Verify the evidence.</strong>
          <p>Operational summary of collected security events. Open any record to inspect its source and raw data.</p>
        </div>
        <div className="tp-forensic-intro-side">
          <span>COLLECTION STATUS</span>
          <strong><span className="tp-forensic-status-dot"/> {loading ? 'Loading events' : `${events.length} events indexed`}</strong>
          <small>Based on the current event timeline</small>
        </div>
      </div>
      {/* Counted from the events already loaded, so the charts need no extra
          request and cannot disagree with the table below them. */}
      <EvidenceCharts
        events={events}
        timestampOf={timestamp}
        eventTypeOf={eventType}
        deviceOf={device}
        isFailure={fail}
      />
      {/* TRACEPOINT_PUBLIC_PORTAL_SERVICES_V1: functional quick-access tiles */}
      <nav className="tp-portal-services" aria-label="Quick access to TracePoint tools">
        {[
          ['ingestion', 'Log Ingestion Lab', 'Submit and inspect sample logs', Terminal],
          ['timeline', 'Event Timeline', 'Search collected security events', Activity],
          ['evidence', 'Evidence Register', 'Review evidence and SHA-256 records', Fingerprint],
          ['graph', 'Investigation Graph', 'Explore linked event sequences', GitBranch],
          ['reports', 'Reports & Export', 'Review and export investigation reports', FileText],
        ].map(([id, label, description, Icon]) => (
          <button key={id} type="button" className="tp-portal-service" onClick={() => openPage(id)}>
            <span className="tp-portal-service-icon"><Icon size={21} aria-hidden="true" /></span>
            <span className="tp-portal-service-copy"><strong>{label}</strong><small>{description}</small></span>
            <span className="tp-portal-service-open">Open tool <ChevronRight aria-hidden="true" /></span>
          </button>
        ))}
      </nav>
      <div className="tp-metrics tp-forensic-metrics">
        <Metric label="Collected events" value={loading ? '…' : events.length.toLocaleString()} note="Available for inspection" icon={Activity}/>
        <Metric label="Authentication failures" value={loading ? '…' : failures.toLocaleString()} note={`${affectedDevices} source ${affectedDevices === 1 ? 'device' : 'devices'} affected`} icon={ShieldAlert}/>
        <Metric label="Source devices" value={loading ? '…' : devices} note="Unique device identifiers" icon={Fingerprint}/>
        <Metric label="Users observed" value={loading ? '…' : users} note="Unique usernames" icon={FileClock}/>
      </div>
      <div className="tp-forensic-section-title"><div><span className="tp-forensic-section-index">01 / ACTIVITY</span><h2>Event analysis</h2></div><span>Last 7 days · current collection</span></div>
      <div className="tp-analytics tp-forensic-analytics"><TrendChart events={events}/><SeverityCard events={events}/></div>
      <div className="tp-forensic-review">
        <div className="tp-forensic-review-title"><ShieldAlert size={18}/><div><strong>Data quality signals</strong><span>Indicators detected in collected events, not verified incidents</span></div></div>
        <div className="tp-forensic-review-items">
          <div><strong>{loading ? '…' : parsingIssues}</strong><span>Events with parsing gaps</span></div>
          <div><strong>{loading ? '…' : timestampIssues}</strong><span>Inferred or conflicting timestamps</span></div>
          <div><strong>{loading ? '…' : clockAhead}</strong><span>Events dated after receipt</span></div>
          <div><strong>{loading ? '…' : failures}</strong><span>Events matching failure indicators</span></div>
        </div>
      </div>
      <div className="tp-forensic-section-title"><div><span className="tp-forensic-section-index">02 / EVIDENCE</span><h2>Recent security events</h2></div><button className="tp-forensic-all-events" onClick={() => openPage('timeline')}>Open event explorer <ChevronRight size={16}/></button></div>
      <section className="tp-card tp-events-card tp-forensic-events"><EventTable rows={sorted.slice(0, 6)} loading={loading} onSelect={setSelected}/></section>
    </>}
    {/* TRACEPOINT_TIMELINE_WORKSPACE_V1 */}
    {page === 'timeline' && <div className="tp-timeline-workspace">
      <div className="tp-timeline-summary" aria-label="Timeline summary">
        <div><span>Events in view</span><strong>{timelineReady ? <AnimatedCount value={filtered.length} animationKey={timelineAnimationKey}/> : '…'}</strong><small>of {events.length.toLocaleString()} collected</small></div>
        <div className="is-signal"><span>Authentication failures</span><strong>{timelineReady ? <AnimatedCount value={filtered.filter(fail).length} animationKey={timelineAnimationKey}/> : '…'}</strong><small>matching failure indicators</small></div>
        <div><span>Source devices</span><strong>{timelineReady ? <AnimatedCount value={new Set(filtered.map(device).filter(d => d !== '—')).size} animationKey={timelineAnimationKey}/> : '…'}</strong><small>in the current results</small></div>
        <div className="tp-timeline-summary-note"><ShieldAlert size={18}/><span>Events are investigative leads, not verified incidents. Select a row to inspect its raw evidence.</span></div>
      </div>
      {/* One toolbar row. The heading block that used to sit above this read
          "EVENT EXPLORER / Collected event records / Search the timeline and
          inspect individual source records." directly under a page header
          already reading "Event timeline / Explore, filter and inspect
          security events." - the same sentence twice, costing about 120px of
          the first screen before a single record appeared. */}
      <section className="tp-card tp-events-card tp-timeline-panel tp-timeline-toolbar">
        <div className="tp-timeline-controls">
          <label className="tp-timeline-search"><Search size={18}/><input aria-label="Search events" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search events, devices, users or log content"/></label>
          <label className="tp-timeline-select"><SlidersHorizontal size={17}/><select aria-label="Filter by severity" value={level} onChange={e => setLevel(e.target.value)}><option value="all">All severities</option>{levels.map(v => <option value={v} key={v}>{v}</option>)}</select></label>
          {(search || level !== 'all') && <Button variant="ghost" className="tp-timeline-clear" onClick={() => { setSearch(''); setLevel('all'); }}>Clear filters</Button>}
          <span className="tp-timeline-result-count">
            {filtered.length} of {events.length.toLocaleString()} events · grouped by device, user and date
          </span>
        </div>
      </section>
      {/* The flat table this replaces listed every record newest-first with no
          sense of which host or account it belonged to, so reading a single
          user's day meant scrolling the whole collection. The search and
          severity filters above still apply: the explorer is given `filtered`,
          not the raw collection. */}
      <TimelineExplorer events={filtered} loading={loading} onInspect={setSelected}/>
    </div>}
    {page === 'evidence' && (
      <LazyPage name="Evidence Library">
        <EvidenceLibrary refreshSignal={evidenceRefresh} />
      </LazyPage>
    )}
    {page === 'ingestion' && (
      <LazyPage name="Log Ingestion Lab">
        <LogIngestionLab
          onIngested={() => {
            refresh();
            setEvidenceRefresh(v => v + 1);
          }}
          onViewTimeline={() => openPage('timeline')}
        />
      </LazyPage>
    )}
    {page === 'investigations' && (
      <LazyPage name="Investigations">
        <Investigations events={events} />
      </LazyPage>
    )}
    {page === 'graph' && (
      <LazyPage name="Investigation Graph">
        <div className="tp-graph-page">
          <InvestigationGraph theme={theme} />
        </div>
      </LazyPage>
    )}
    {page === 'guide' && (
      <section className="tp-workflow-guide" aria-label="TracePoint workflow guide">
        <div className="tp-workflow-intro">
          <span className="tp-workflow-kicker">INVESTIGATION WORKFLOW</span>
          <h2>From raw logs to a defensible report</h2>
          <p>Use this guide to move through the TracePoint workflow. Each action opens the corresponding workspace in this dashboard.</p>
          <div className="tp-workflow-principle"><strong>Evidence first.</strong> Keep original evidence separate from normalized events, and review any parsing gaps instead of treating incomplete data as complete.</div>
        </div>
        <div className="tp-workflow-steps">
          <article className="tp-workflow-step">
            <span className="tp-workflow-number">01</span><div className="tp-workflow-step-copy">
              <span className="tp-workflow-step-label">COLLECT</span><h3>Ingest raw logs</h3>
              <p>Start with a log batch or the collection-agent flow. Check that the ingestion result is accepted before continuing.</p>
              <button type="button" className="tp-button" onClick={() => openPage('ingestion')}>Open Log Ingestion Lab <ChevronRight size={16}/></button>
            </div>
          </article>
          <article className="tp-workflow-step">
            <span className="tp-workflow-number">02</span><div className="tp-workflow-step-copy">
              <span className="tp-workflow-step-label">PRESERVE</span><h3>Check evidence integrity</h3>
              <p>Review the stored evidence and its SHA-256 digest. A matching digest confirms the bytes match the recorded digest; it does not by itself prove origin or chain of custody.</p>
              <button type="button" className="tp-button" onClick={() => openPage('evidence')}>Open Evidence <ChevronRight size={16}/></button>
            </div>
          </article>
          <article className="tp-workflow-step">
            <span className="tp-workflow-number">03</span><div className="tp-workflow-step-copy">
              <span className="tp-workflow-step-label">NORMALIZE & SEARCH</span><h3>Review the event timeline</h3>
              <p>Examine parsed events and timestamps, search by event, device or username, and check unusual ordering or records that did not parse cleanly.</p>
              <button type="button" className="tp-button" onClick={() => openPage('timeline')}>Open Event Timeline <ChevronRight size={16}/></button>
            </div>
          </article>
          <article className="tp-workflow-step">
            <span className="tp-workflow-number">04</span><div className="tp-workflow-step-copy">
              <span className="tp-workflow-step-label">INVESTIGATE</span><h3>Create an investigation</h3>
              <p>Open a case, link relevant events, record analyst notes and keep the reason for each conclusion understandable.</p>
              <button type="button" className="tp-button" onClick={() => openPage('investigations')}>Open Investigations <ChevronRight size={16}/></button>
            </div>
          </article>
          <article className="tp-workflow-step">
            <span className="tp-workflow-number">05</span><div className="tp-workflow-step-copy">
              <span className="tp-workflow-step-label">CORRELATE</span><h3>Explore event relationships</h3>
              <p>Use the graph to examine related authentication activity and sequences. Treat links as investigative leads that need evidence-based review.</p>
              <button type="button" className="tp-button" onClick={() => openPage('graph')}>Open Investigation Graph <ChevronRight size={16}/></button>
            </div>
          </article>
          <article className="tp-workflow-step">
            <span className="tp-workflow-number">06</span><div className="tp-workflow-step-copy">
              <span className="tp-workflow-step-label">DOCUMENT</span><h3>Generate the incident report</h3>
              <p>Review the case report, linked events, analyst notes and integrity details before exporting or sharing the report.</p>
              <button type="button" className="tp-button" onClick={() => openPage('reports')}>Open Reports <ChevronRight size={16}/></button>
            </div>
          </article>
        </div>
        <p className="tp-workflow-footnote">Tip: a normal-looking timeline does not prove that every record was parsed. Check evidence and parsing gaps before drawing conclusions.</p>
      </section>
    )}

    {page === 'reports' && (
      <LazyPage name="Reports">
        <div className="tp-reports-page">
          <Reports onExportCsv={exportCsv} />
        </div>
      </LazyPage>
    )}
      </div>
      {/* TRACEPOINT_HACKATHON_FOOTER_V3 */}
      <footer className="tp-site-footer" aria-label="TracePoint project information">
        <div className="tp-footer-about">
          <span className="tp-footer-brand">tracepoint<span>.</span></span>
          <h2>About TracePoint</h2>
          <p>TracePoint is a cybersecurity investigation prototype built for a hackathon project. It helps analysts review collected logs, correlate events, and inspect evidence integrity. It is a demonstration tool, not a certified security product.</p>
          <small>Hackathon prototype · For demonstration and evaluation</small>
        </div>
        <div className="tp-footer-column">
          <h3>Quick links</h3>
          <button type="button" onClick={() => openPage('overview')}>Overview</button>
          <button type="button" onClick={() => openPage('timeline')}>Event timeline</button>
          <button type="button" onClick={() => openPage('evidence')}>Evidence library</button>
          <button type="button" onClick={() => openPage('investigations')}>Investigations</button>
        </div>
        <div className="tp-footer-column">
          <h3>Tools</h3>
          <button type="button" onClick={() => openPage('ingestion')}>Log Ingestion Lab</button>
          <button type="button" onClick={() => openPage('graph')}>Investigation Graph</button>
          <button type="button" onClick={() => openPage('reports')}>Reports</button>

        </div>
        <div className="tp-footer-column tp-footer-info">
          <h3>Project information</h3>
          <p>Focus: log analysis, event correlation, parsing gaps, and evidence integrity.</p>
          <p>Results depend on evidence collected in this workspace.</p>
          <p className="tp-footer-note">Prototype status: not a replacement for a complete incident-response or forensic workflow.</p>
        </div>
        <div className="tp-footer-bottom"><span>© {new Date().getFullYear()} TracePoint · Hackathon prototype</span><span>Built for security investigation and learning.</span></div>
      </footer>

    </main>
    {selected && <div className="tp-overlay tp-timeline-event-overlay" onMouseDown={() => setSelected(null)}><aside className="tp-drawer tp-timeline-event-modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Event details"><div className="tp-drawer-header"><div><span>Event inspection</span><h2>{eventType(selected)}</h2><div className={`tp-severity ${severityClass(severity(selected))}`}>{severity(selected)}</div></div><button onClick={() => setSelected(null)} aria-label="Close event details"><X size={21}/></button></div><div className="tp-drawer-body"><h3>Event information</h3>{[['Timestamp', fullDate(timestamp(selected))], ['Source device', device(selected)], ['Username', selected.username], ['Event type', eventType(selected)], ['Severity', severity(selected)], ['Message', message(selected)], ['Clock check', clockLabel(selected)]].map(([label, value]) => <div className="tp-detail" key={label}><span>{label}</span><strong>{text(value)}</strong></div>)}<h3>Raw event data</h3><pre>{JSON.stringify(selected, null, 2)}</pre></div></aside></div>}
  </div>;
}
