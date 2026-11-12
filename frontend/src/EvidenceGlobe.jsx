import { useEffect, useMemo, useRef, useState } from 'react';
import { isLand } from './landmask';
import './styles/EvidenceGlobe.css';

/* THE EVIDENCE GLOBE
   ---------------------------------------------------------------------------
   A rotating dot-matrix Earth.

   WHERE THE LINE IS DRAWN
   The land is real geography and claims nothing about the evidence. Event
   markers use stable positions derived from event identity, not geographic
   data. Tracepoint has no geolocation - parser.py never extracts a source IP
   into a field and there is no lookup service - so marker positions do not
   represent real locations.

   WHAT IS REAL
     markers       one per event, coloured by its real severity, larger when
                   it carries a failure indicator
     readouts      real counts

   Nothing is randomised; the same evidence always draws the same globe. */

const R = 118;
const CX = 150;
const CY = 150;
const LAT_STEP = 3.4;
const RING_DOTS = 72;


/* The sphere's surface as a lat/lon grid. Rings thin towards the poles so the
   spacing stays even, which is what makes a flat projection read as a ball. */
/* Two grids, not one.

   The first version dotted land and ocean at nearly the same weight and the
   continents were lost in it. Dropping the ocean entirely fixed that but left
   the sphere blank whenever it turned to face the Pacific, so the dot pattern
   that makes it a dot-matrix globe kept disappearing.

   So: a dense, bright grid on land, and a sparse, very faint one over the
   whole sphere underneath it. The faint grid is what keeps the surface
   readable at every angle; it is quiet enough that the continents still
   carry the shape. */
function buildGrid() {
  const cells = [];
  for (let lat = -88; lat <= 88; lat += LAT_STEP) {
    const phi = (lat * Math.PI) / 180;
    const ringR = Math.cos(phi);
    const count = Math.max(6, Math.round(150 * ringR));
    for (let j = 0; j < count; j += 1) {
      const lon = -180 + (j / count) * 360;
      if (!isLand(lat, lon)) continue;
      cells.push({ lat, lon, phi, land: true });
    }
  }
  for (let lat = -84; lat <= 84; lat += LAT_STEP * 2.2) {
    const phi = (lat * Math.PI) / 180;
    const ringR = Math.cos(phi);
    const count = Math.max(5, Math.round(46 * ringR));
    for (let j = 0; j < count; j += 1) {
      cells.push({ lat, lon: -180 + (j / count) * 360, phi, land: false });
    }
  }
  return cells;
}

const SEV_VAR = {
  critical: 'var(--fx-critical)', high: 'var(--fx-high)', medium: 'var(--fx-medium)',
  warning: 'var(--fx-medium)', low: 'var(--fx-low)', info: 'var(--fx-verified)',
};
const sevVar = s => SEV_VAR[String(s || '').trim().toLowerCase()] || 'var(--fx-info)';

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}

function eventPosition(event, index) {
  const identity = String(
    event.id ??
    event.event_id ??
    `${event.timestamp || ''}-${event.device_id || ''}-${index}`
  );

  const a = hash(identity);
  const b = hash(`${identity}-longitude`);

  return {
    lat: (a * 140) - 70,
    lon: (b * 360) - 180,
  };
}

export default function EvidenceGlobe({
  events = [],
  severityOf = e => e.severity,
  deviceOf = e => e.device_id,
  isFailure = () => false,
  timestampOf = e => e.timestamp,
}) {
  const grid = useMemo(() => buildGrid(), []);
  const [spin, setSpin] = useState(0);
  // Tilt is the second axis. Without it a drag could only ever slide the
  // globe sideways, which does not feel like holding a ball.
  const [tilt, setTilt] = useState(-0.18);
  const [dragging, setDragging] = useState(false);
  const raf = useRef(0);
  const drag = useRef(null);

  /* Real rotation, not a CSS spin of the whole disc: the longitude offset
     advances and the projection is recomputed, so continents round the limb
     and disappear the way they should. Throttled to about 15fps, which is
     enough for something this slow and keeps the work small. */
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    let last = 0;
    const tick = now => {
      // The idle drift stops while a hand is on it, so the globe does not
      // creep out from under the pointer mid-drag.
      if (!dragging && now - last > 66) { setSpin(s => (s + 0.55) % 360); last = now; }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [dragging]);

  /* Drag to turn it. Pointer events rather than mouse events so a trackpad,
     a touchscreen and a pen all work, and capture so the gesture survives the
     pointer leaving the circle. Horizontal drag spins, vertical drag tilts,
     and tilt is clamped short of the poles because past that the projection
     flips and the globe appears to turn inside out. */
  const onPointerDown = e => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, spin, tilt };
    setDragging(true);
  };
  const onPointerMove = e => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    setSpin(((drag.current.spin + dx * 0.45) % 360 + 360) % 360);
    setTilt(Math.max(-1.1, Math.min(1.1, drag.current.tilt + dy * 0.006)));
  };
  const endDrag = e => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  /* Keyboard equivalent, so the globe is not mouse-only. */
  const onKeyDown = e => {
    const step = e.shiftKey ? 15 : 5;
    if (e.key === 'ArrowLeft') { setSpin(s => (s - step + 360) % 360); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setSpin(s => (s + step) % 360); e.preventDefault(); }
    if (e.key === 'ArrowUp') { setTilt(t => Math.max(-1.1, t - 0.08)); e.preventDefault(); }
    if (e.key === 'ArrowDown') { setTilt(t => Math.min(1.1, t + 0.08)); e.preventDefault(); }
  };

  const dots = useMemo(() => {
    const out = [];
    const ct = Math.cos(tilt); const st = Math.sin(tilt);
    for (const c of grid) {
      const theta = ((c.lon + spin) * Math.PI) / 180;
      // Rotate about the vertical axis for the spin, then about the
      // horizontal one for the tilt. Depth after both rotations decides
      // whether a point is on the near face at all.
      const x1 = Math.cos(c.phi) * Math.sin(theta);
      const y1 = Math.sin(c.phi);
      const z1 = Math.cos(c.phi) * Math.cos(theta);
      const y2 = y1 * ct - z1 * st;
      const z2 = y1 * st + z1 * ct;
      if (z2 <= 0.02) continue;
      out.push({ x: CX + x1 * R, y: CY - y2 * R, z: z2, land: c.land });
    }
    return out;
  }, [grid, spin, tilt]);

  const model = useMemo(() => {
    const ordered = [...events].sort(
      (a, b) =>
        (Date.parse(timestampOf(a)) || 0) -
        (Date.parse(timestampOf(b)) || 0),
    );
    const markers = ordered.slice(-RING_DOTS).map((e, i) => {
      const position = eventPosition(e, i);

      return {
        ...position,
        fill: sevVar(severityOf(e)),
        fail: isFailure(e),
        label: `${severityOf(e) || 'unknown'} · ${deviceOf(e) || 'unknown device'}`,
      };
    });
    const failures = events.filter(isFailure).length;
    const devices = new Set(
      events.map(deviceOf).filter(d => d && d !== '—')
    ).size;

    return {
      markers,
      failures,
      devices,
      total: events.length,
    };
  }, [events, severityOf, deviceOf, isFailure, timestampOf]);

  const surfaceMarkers = useMemo(() => {
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);

    return model.markers.map(marker => {
      const phi = marker.lat * Math.PI / 180;
      const theta = (marker.lon + spin) * Math.PI / 180;

      const x1 = Math.cos(phi) * Math.sin(theta);
      const y1 = Math.sin(phi);
      const z1 = Math.cos(phi) * Math.cos(theta);

      const y2 = y1 * ct - z1 * st;
      const z2 = y1 * st + z1 * ct;

      return {
        ...marker,
        x: CX + x1 * R,
        y: CY - y2 * R,
        z: z2,
        visible: z2 > 0.08,
      };
    });
  }, [model.markers, spin, tilt]);

  const empty = model.total === 0;

  return (
    <figure className="tp-globe" data-empty={empty || undefined}>
      <svg
        className="tp-globe-svg"
        viewBox="0 0 300 300"
        role="img"
        tabIndex={0}
        data-dragging={dragging || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
           aria-label={empty
             ? 'Evidence globe. No events collected yet.'
             : `Evidence globe: ${model.total} events across ${model.devices} devices, ${model.failures} carrying failure indicators. Drag or use the arrow keys to turn it.`}
      >
        <defs>
          <radialGradient id="tp-globe-shade" cx="36%" cy="31%" r="80%">
            <stop offset="0%" stopColor="var(--fx-globe)" stopOpacity="0.16" />
            <stop offset="52%" stopColor="#050810" stopOpacity="0.94" />
            <stop offset="100%" stopColor="#03050a" stopOpacity="1" />
          </radialGradient>
          {/* The rim light. A hard stroke round the edge made the thing read
              as a flat disc with a border; a soft falloff over the last tenth
              of the radius reads as a lit edge instead. */}
          <radialGradient id="tp-globe-rim" cx="50%" cy="50%" r="50%">
            <stop offset="90%" stopColor="var(--fx-globe)" stopOpacity="0" />
            <stop offset="97.5%" stopColor="var(--fx-globe)" stopOpacity="0.38" />
            <stop offset="99.5%" stopColor="var(--fx-globe)" stopOpacity="0.72" />
            <stop offset="100%" stopColor="var(--fx-globe)" stopOpacity="0.15" />
          </radialGradient>
          {/* The atmosphere: the same edge, blurred outward, so the glow sits
              off the surface rather than on it. */}
          <filter id="tp-globe-atmo-blur" x="-45%" y="-45%" width="190%" height="190%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <filter id="tp-event-glow" x="-200%" y="-200%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* atmosphere, body, rim light - in that order, so the glow is
            behind the sphere and the lit edge sits on top of it */}
        <circle className="tp-globe-atmo" cx={CX} cy={CY} r={R + 2}
                filter="url(#tp-globe-atmo-blur)" />
        <circle cx={CX} cy={CY} r={R} fill="url(#tp-globe-shade)" />
        <circle className="tp-globe-rim" cx={CX} cy={CY} r={R} fill="url(#tp-globe-rim)" />

        {/* The surface: a faint grid everywhere, the continents bright on
            top of it. Both fade towards the limb, which is what reads as
            curvature. */}
        <g className="tp-globe-surface">
          {dots.map((d, i) => (
            <circle
              key={i} cx={d.x} cy={d.y}
              r={d.land ? 0.9 + d.z * 1.25 : 0.4 + d.z * 0.45}
              className={d.land ? 'is-land' : 'is-grid'}
              opacity={d.land ? 0.32 + d.z * 0.66 : 0.06 + d.z * 0.16}
            />
          ))}
        </g>

        <g className="tp-globe-markers">
          {surfaceMarkers.filter(d => d.visible).map((d, i) => (
            <g key={i}>
              <circle
                cx={d.x}
                cy={d.y}
                r={d.fail ? 5 : 3.8}
                fill={d.fill}
                opacity={0.25}
                filter="url(#tp-event-glow)"
              />
              <circle
                cx={d.x}
                cy={d.y}
                r={d.fail ? 2.7 : 2}
                fill={d.fill}
                opacity={Math.min(1, 0.55 + d.z * 0.45)}
              >
                <title>{d.label}</title>
              </circle>
            </g>
          ))}
        </g>
      </svg>

      <figcaption className="tp-globe-readout">
        {empty ? <span className="tp-globe-note">No evidence collected yet</span> : (
          <>
            <span className="tp-globe-stat"><strong>{model.total}</strong> events</span>
            <span className="tp-globe-stat"><strong>{model.devices}</strong> devices</span>
            <span className="tp-globe-stat is-flagged"><strong>{model.failures}</strong> failures</span>
            <span className="tp-globe-note">
              Markers are placed on the globe by a stable event-derived position; they do not represent real locations.
            </span>
          </>
        )}
      </figcaption>
    </figure>
  );
}
