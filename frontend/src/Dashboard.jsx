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
import { Wifi, WifiOff, Activity, ArrowDownToLine, ChevronRight, FileClock, FileText, Fingerprint, LayoutDashboard, LogOut, RefreshCw, Search, ShieldAlert, SlidersHorizontal, Terminal, X, GitBranch, BookOpen} from 'lucide-react';
import './styles/Tracepoint.css';
import './styles/TracepointTimelineGraphModal.css';
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
    time: d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short'
    }),
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


// Timeline-only hierarchy. EventTable remains unchanged for Overview.
const loginKind = event => {
  const kind = eventType(event).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (kind === 'failed login') return 'failed';
  if (kind === 'successful login') return 'successful';
  return null;
};

function GroupedTimeline({ rows, loading, onSelect, selected }) {
  const ordered = useMemo(() => [...rows].sort((a, b) => {
    const ta = Date.parse(timestamp(a));
    const tb = Date.parse(timestamp(b));
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  }), [rows]);

  const days = useMemo(() => {
    const map = new Map();
    ordered.forEach(event => {
      const raw = timestamp(event);
      const parsed = Date.parse(raw);
      const date = Number.isNaN(parsed) ? null : new Date(parsed);
      const key = date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        : 'unavailable';
      if (!map.has(key)) map.set(key, {
        key,
        label: date ? date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Date unavailable',
        events: []
      });
      map.get(key).events.push(event);
    });
    return [...map.values()];
  }, [ordered]);

  const inspectedEvent = selected && ordered.includes(selected) ? selected : (ordered[0] || null);
  const failed = ordered.filter(fail).length;
  const successful = ordered.filter(e => loginKind(e) === 'successful').length;
  const deviceCount = new Set(ordered.map(device).filter(v => v !== '—')).size;
  const userCount = new Set(ordered.map(e => text(e.username)).filter(v => v !== '—')).size;
  const critical = ordered.filter(e => ['critical', 'high'].includes(severity(e))).length;

  return <div className="tp-timeline-three-panel">
    <section className="tp-timeline-event-list tp-timeline-surface" aria-label="Events grouped by date">
      <header className="tp-timeline-panel-title">
        <div><span className="tp-timeline-eyebrow">EVIDENCE STREAM</span><h2>All events</h2></div>
        <span className="tp-timeline-result-count">{ordered.length.toLocaleString()} records</span>
      </header>
      <div className="tp-timeline-date-groups">
        {days.map(day => <section className="tp-timeline-date-group" key={day.key}>
          <div className="tp-timeline-date-heading"><strong>{day.label}</strong><span>{day.events.length} events</span></div>
          {day.events.map((event, index) => {
            const when = eventDateParts(timestamp(event));
            const kind = loginKind(event);
            const active = inspectedEvent === event;
            return <button type="button" key={`${event.id || event.event_id || timestamp(event)}-${index}`}
              className={`tp-timeline-event-row ${active ? 'is-selected' : ''} ${fail(event) ? 'is-failure' : ''}`}
              onClick={() => onSelect(event)} aria-pressed={active}>
              <time>{when.time || 'Time unavailable'}</time>
              <span className="tp-timeline-event-copy"><strong>{eventType(event)}</strong><small>{message(event) !== '—' ? message(event) : `${device(event)} · ${text(event.username)}`}</small></span>
              <span className={`tp-timeline-event-severity ${severityClass(severity(event))}`}>{severity(event)}</span>
            </button>;
          })}
        </section>)}
      </div>
      {loading && <div className="tp-empty">Loading events…</div>}
      {!loading && !ordered.length && <div className="tp-empty">No matching events. Check the agent connection or clear the filters.</div>}
      <p className="tp-timeline-forensic-note">Collected records are evidence. Patterns are investigative leads, not confirmed incidents.</p>
    </section>

    <aside className="tp-timeline-inspector-panel tp-timeline-surface" aria-label="Selected event details">
      <div className="tp-inspector-heading"><div><span className="tp-inspector-kicker">EVIDENCE INSPECTOR</span><h3>Event details</h3></div>
        {inspectedEvent && <span className={`tp-inspector-severity ${severityClass(severity(inspectedEvent))}`}>{severity(inspectedEvent)}</span>}
      </div>
      {inspectedEvent ? <>
        <div className="tp-inspector-primary"><span className="tp-inspector-label">EVENT MESSAGE</span><p>{message(inspectedEvent) !== '—' ? message(inspectedEvent) : 'No message recorded'}</p><time>{fullDate(timestamp(inspectedEvent))}</time></div>
        <div className="tp-inspector-fields">
          <div><span>Source device</span><strong>{device(inspectedEvent)}</strong></div>
          <div><span>Username</span><strong>{text(inspectedEvent.username)}</strong></div>
          <div><span>Event type</span><strong>{eventType(inspectedEvent)}</strong></div>
          <div><span>Severity</span><strong>{severity(inspectedEvent)}</strong></div>
          <div><span>Clock check</span><strong>{clockLabel(inspectedEvent)}</strong></div>
        </div>
        <details className="tp-inspector-raw" open><summary>Raw evidence record</summary><pre>{JSON.stringify(inspectedEvent, null, 2)}</pre></details>
      </> : <div className="tp-inspector-empty"><span>NO EVENT AVAILABLE</span><p>Select an event to inspect its source record.</p></div>}
    </aside>

    <aside className="tp-timeline-activity-summary tp-timeline-surface" aria-label="Activity summary">
      <header className="tp-timeline-panel-title"><div><span className="tp-timeline-eyebrow">COLLECTION INTELLIGENCE</span><h2>Activity summary</h2></div></header>
      <div className="tp-timeline-stat-primary"><span>Events in view</span><strong>{ordered.length.toLocaleString()}</strong><small>Current filtered results</small></div>
      <div className="tp-timeline-stat-grid">
        <div><span>Failed events</span><strong className="is-alert">{failed.toLocaleString()}</strong></div>
        <div><span>Successful logins</span><strong>{successful.toLocaleString()}</strong></div>
        <div><span>Source devices</span><strong>{deviceCount.toLocaleString()}</strong></div>
        <div><span>Users observed</span><strong>{userCount.toLocaleString()}</strong></div>
        <div><span>High / critical</span><strong className="is-alert">{critical.toLocaleString()}</strong></div>
        <div><span>Dates represented</span><strong>{days.length.toLocaleString()}</strong></div>
      </div>
      <div className="tp-timeline-summary-foot"><span className={`tp-public-utility-dot ${loading ? '' : 'is-online'}`} />{loading ? 'Updating collected evidence' : 'Counts reflect loaded event records'}</div>
      <p className="tp-timeline-forensic-note">Counts are calculated from the events currently loaded and filtered. They do not independently establish an incident.</p>
    </aside>
  </div>;
}

function AnimatedCount({ value }) {
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
  }, [value]);

  return <>{shown.toLocaleString()}</>;
}

function TimelineActivityChart({ events }) {
  const buckets = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (6 - index));

      return {
        key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
        label: date.toLocaleDateString('en', { weekday: 'short' }),
        date,
        total: 0,
        failures: 0
      };
    });

    const byDate = new Map(bucketsMap(days));

    events.forEach(event => {
      const date = new Date(timestamp(event));
      if (Number.isNaN(date.getTime())) return;

      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const bucket = byDate.get(key);

      if (bucket) {
        bucket.total += 1;
        if (fail(event)) bucket.failures += 1;
      }
    });

    return days;
  }, [events]);

  const maximum = Math.max(1, ...buckets.map(day => day.total));
  const scale = Math.ceil(maximum / 4) * 4 || 4;
  const totalEvents = buckets.reduce((sum, day) => sum + day.total, 0);

  return (
    <section className="tp-timeline-chart" aria-label="Seven day event activity chart">
      <div className="tp-timeline-chart-heading">
        <div>
          <span className="tp-timeline-eyebrow">COLLECTION ACTIVITY</span>
          <h2>Event activity</h2>
          <p>Actual collected events · Last 7 days</p>
        </div>
        <div className="tp-timeline-chart-legend">
          <span><i className="tp-chart-legend-total" /> Events</span>
          <span><i className="tp-chart-legend-failures" /> Failure indicators</span>
        </div>
      </div>

      <div className="tp-timeline-chart-body">
        <div className="tp-timeline-chart-axis" aria-hidden="true">
          <span>{scale}</span>
          <span>{Math.round(scale / 2)}</span>
          <span>0</span>
        </div>

        <div className="tp-timeline-chart-plot">
          <div className="tp-timeline-chart-grid" aria-hidden="true">
            <span /><span /><span />
          </div>

          <div className="tp-timeline-chart-columns">
            {buckets.map((day, index) => (
              <div className="tp-timeline-chart-column" key={day.key}>
                <div className="tp-timeline-chart-track">
                  <div
                    className="tp-timeline-chart-bar"
                    style={{
                      height: `${day.total ? Math.max(1, day.total / scale * 100) : 0}%`,
                      '--bar-delay': `${index * 140}ms`
                    }}
                    title={`${day.total} events, ${day.failures} failure indicators`}
                  >
                    {day.failures > 0 && (
                      <span
                        className="tp-timeline-chart-failure"
                        style={{ height: `${day.failures / day.total * 100}%` }}
                      />
                    )}
                  </div>
                </div>
                <span className="tp-timeline-chart-day">{day.label}</span>
                <span className="tp-timeline-chart-value">{day.total}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="tp-timeline-chart-footer">
        <span>{totalEvents.toLocaleString()} events in this period</span>
        <span>Failure indicators are pattern matches, not confirmed incidents</span>
      </div>
    </section>
  );
}

function bucketsMap(days) {
  return days.map(day => [day.key, day]);
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
    const request = Promise.resolve().then(() => refresh());
    if (initialPageRef.current === 'timeline') {
      initialTimelineLoadRef.current = request;
    }
  }, [refresh]);

  // Fetch fresh records once on each entry to Event Timeline.
  useEffect(() => {
    if (page !== 'timeline') return;

    const isInitialTimeline = initialPageRef.current === 'timeline';
    initialPageRef.current = null;

    const request = isInitialTimeline
      ? (initialTimelineLoadRef.current || Promise.resolve().then(() => refresh({ quiet: true })))
      : Promise.resolve().then(() => refresh({ quiet: true }));

    request.catch(() => {
      // refresh() already handles and displays its own errors.
    });
  }, [page, refresh]);

  // TRACEPOINT_REFRESH_ON_RETURN_V1: log collection happens in a terminal while
  // the browser sits in the background, so coming back to the tab re-reads the
  // timeline and the evidence library. This refetches data rather than reloading
  // the document, which would throw away the open case, filters and scroll.
  const lastRefreshRef = useRef(0);
  useEffect(() => {
    lastRefreshRef.current = Date.now();
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
    {page === 'timeline' && <div className="tp-timeline-workspace tp-timeline-redesign-v2">
      <div className="tp-timeline-toolbar">
        <div className="tp-timeline-live-state" role="status"><span className={`tp-public-utility-dot ${apiStatus === 'online' ? 'is-online' : apiStatus === 'offline' ? 'is-offline' : ''}`} />{apiStatus === 'online' ? 'Live connection' : apiStatus === 'offline' ? 'Connection offline' : 'Checking connection'}</div>
        <label className="tp-timeline-search"><Search size={18}/><input aria-label="Search events" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search events, devices, users or log content"/></label>
        <label className="tp-timeline-select"><SlidersHorizontal size={17}/><select aria-label="Filter by severity" value={level} onChange={e => setLevel(e.target.value)}><option value="all">All severities</option>{levels.map(v => <option value={v} key={v}>{v}</option>)}</select></label>
        {(search || level !== 'all') && <Button variant="ghost" className="tp-timeline-clear" onClick={() => { setSearch(''); setLevel('all'); }}>Clear filters</Button>}
        <span className="tp-timeline-toolbar-count">{filtered.length.toLocaleString()} matching records</span>
      </div>
      <div className="tp-timeline-chart-compact"><TimelineActivityChart events={events}/></div>
      <GroupedTimeline rows={filtered} loading={loading} onSelect={setSelected} selected={selected}/>
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
    {selected && page !== 'timeline' && <div className="tp-overlay tp-timeline-event-overlay" onMouseDown={() => setSelected(null)}><aside className="tp-drawer tp-timeline-event-modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Event details"><div className="tp-drawer-header"><div><span>Event inspection</span><h2>{eventType(selected)}</h2><div className={`tp-severity ${severityClass(severity(selected))}`}>{severity(selected)}</div></div><button onClick={() => setSelected(null)} aria-label="Close event details"><X size={21}/></button></div><div className="tp-drawer-body"><h3>Event information</h3>{[['Timestamp', fullDate(timestamp(selected))], ['Source device', device(selected)], ['Username', selected.username], ['Event type', eventType(selected)], ['Severity', severity(selected)], ['Message', message(selected)], ['Clock check', clockLabel(selected)]].map(([label, value]) => <div className="tp-detail" key={label}><span>{label}</span><strong>{text(value)}</strong></div>)}<h3>Raw event data</h3><pre>{JSON.stringify(selected, null, 2)}</pre></div></aside></div>}
  </div>;
}
