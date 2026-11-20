import React, { useEffect, useMemo, useRef, useState, useCallback, memo } from 'react';
import { isLand } from './landmask';
import './styles/EvidenceGlobe.css';

/* THE EVIDENCE GLOBE — AIORI-3 TELEMETRY EDITION
   ---------------------------------------------------------------------------
   A rotating dot-matrix Earth locking onto India (21.5°N, 78.5°E) with
   tricolor landmass highlight and radiating pulses.
   --------------------------------------------------------------------------- */

const R = 145;
const CX = 210;
const CY = 155;
const LAT_STEP = 3.4;
const RING_DOTS = 72;

// India target coordinates
const INDIA_LAT = 21.5;
const INDIA_LON = 78.5;
// For theta = (lon + spin) = 0: spin = 360 - 78.5 = 281.5°
const TARGET_SPIN = ((360 - INDIA_LON) % 360 + 360) % 360;
// Positive tilt (+0.375 rad = 21.5°) brings the northern hemisphere down to the horizontal center
const TARGET_TILT = +0.375;

function buildGrid() {
  const cells = [];
  for (let lat = -88; lat <= 88; lat += LAT_STEP) {
    const phi = (lat * Math.PI) / 180;
    const ringR = Math.cos(phi);
    const count = Math.max(6, Math.round(150 * ringR));
    for (let j = 0; j < count; j += 1) {
      const lon = -180 + (j / count) * 360;
      if (!isLand(lat, lon)) continue;
      const inIndia = lat >= 7.5 && lat <= 36.5 && lon >= 68 && lon <= 92;
      let tricolor = null;
      if (inIndia) {
        if (lat >= 24) tricolor = '#FF9933'; // Saffron
        else if (lat >= 16.5) tricolor = '#FFFFFF'; // White
        else tricolor = '#138808'; // India Green
      }
      cells.push({ lat, lon, phi, land: true, inIndia, tricolor });
    }
  }
  for (let lat = -84; lat <= 84; lat += LAT_STEP * 2.2) {
    const phi = (lat * Math.PI) / 180;
    const ringR = Math.cos(phi);
    const count = Math.max(5, Math.round(46 * ringR));
    for (let j = 0; j < count; j += 1) {
      cells.push({ lat, lon: -180 + (j / count) * 360, phi, land: false, inIndia: false, tricolor: null });
    }
  }
  return cells;
}

const SEV_VAR = {
  critical: '#D9381E',
  high: '#E66A1F',
  medium: '#D97706',
  warning: '#D97706',
  low: '#2D6A4F',
  info: '#1B4D3E',
};
const sevVar = s => SEV_VAR[String(s || '').trim().toLowerCase()] || '#2D6A4F';

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

function EvidenceGlobe({
  events = [],
  severityOf = e => e.severity,
  deviceOf = e => e.device_id,
  isFailure = () => false,
  timestampOf = e => e.timestamp,
}) {
  const grid = useMemo(() => buildGrid(), []);

  // Spin & Tilt state
  const [spin, setSpin] = useState(TARGET_SPIN - 160);
  const [tilt, setTilt] = useState(0.1);
  const [dragging, setDragging] = useState(false);

  // Animation State: 'spinning' -> 'locked'
  const [introState, setIntroState] = useState('locked');
  const [pulseCount, setPulseCount] = useState(0);

  const raf = useRef(0);
  const drag = useRef(null);

  // Smooth rotation settling onto India
  const startIntroSequence = useCallback(() => {
    setIntroState('spinning');
    const startSpin = (TARGET_SPIN - 160 + 360) % 360;
    setSpin(startSpin);
    setTilt(0.12);

    const spinStart = performance.now();
    const spinDuration = 1800;
    const initialSpin = startSpin;
    const deltaSpin = (TARGET_SPIN - initialSpin + 720) % 360 + 360;
    const initialTilt = 0.12;

    const animateSpin = tNow => {
      const sElapsed = tNow - spinStart;
      const sp = Math.min(1, sElapsed / spinDuration);
      const ease = 1 - Math.pow(1 - sp, 3.5);

      setSpin((initialSpin + deltaSpin * ease) % 360);
      setTilt(initialTilt + (TARGET_TILT - initialTilt) * ease);

      if (sp < 1) {
        raf.current = requestAnimationFrame(animateSpin);
      } else {
        // Locked dead-center on India with Tricolor celebration
        setSpin(TARGET_SPIN);
        setTilt(TARGET_TILT);
        setIntroState('locked');
        setPulseCount(c => c + 1);
      }
    };

    raf.current = requestAnimationFrame(animateSpin);
  }, []);

  // Run on mount
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSpin(TARGET_SPIN);
      setTilt(TARGET_TILT);
      setIntroState('locked');
      return undefined;
    }

    const timer = setTimeout(() => {
      startIntroSequence();
    }, 250);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf.current);
    };
  }, [startIntroSequence]);

  // Pointer drag gestures
  const onPointerDown = e => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, spin, tilt };
    setDragging(true);
    if (introState !== 'locked') {
      setIntroState('locked');
    }
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
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };

  const onKeyDown = e => {
    const step = e.shiftKey ? 15 : 5;
    if (e.key === 'ArrowLeft') { setSpin(s => (s - step + 360) % 360); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setSpin(s => (s + step) % 360); e.preventDefault(); }
    if (e.key === 'ArrowUp') { setTilt(t => Math.max(-1.1, t - 0.08)); e.preventDefault(); }
    if (e.key === 'ArrowDown') { setTilt(t => Math.min(1.1, t + 0.08)); e.preventDefault(); }
  };

  // Compute Surface Dots with India Highlight
  const dots = useMemo(() => {
    const out = [];
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    for (const c of grid) {
      const theta = ((c.lon + spin) * Math.PI) / 180;
      const x1 = Math.cos(c.phi) * Math.sin(theta);
      const y1 = Math.sin(c.phi);
      const z1 = Math.cos(c.phi) * Math.cos(theta);
      const y2 = y1 * ct - z1 * st;
      const z2 = y1 * st + z1 * ct;
      if (z2 <= 0.02) continue;
      out.push({
        x: CX + x1 * R,
        y: CY - y2 * R,
        z: z2,
        land: c.land,
        inIndia: c.inIndia,
        tricolor: c.tricolor,
      });
    }
    return out;
  }, [grid, spin, tilt]);

  // Event Markers
  const model = useMemo(() => {
    const ordered = [...events].sort(
      (a, b) => (Date.parse(timestampOf(a)) || 0) - (Date.parse(timestampOf(b)) || 0)
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
    const devices = new Set(events.map(deviceOf).filter(d => d && d !== '—')).size;

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
      const phi = (marker.lat * Math.PI) / 180;
      const theta = ((marker.lon + spin) * Math.PI) / 180;

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
    <figure className="tp-globe aiori-globe-container" data-empty={empty || undefined}>
      <div className="tp-globe-stage">
        <svg
          className="tp-globe-svg aiori-globe-svg"
          viewBox="0 0 420 310"
          role="img"
          tabIndex={-1}
          style={{ outline: 'none' }}
          data-dragging={dragging || undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          aria-label="Interactive AIORI-3 Evidence Globe"
        >
          <defs>
            {/* Deep Pista-Pine Sphere Gradient */}
            <radialGradient id="tp-globe-shade-pista" cx="35%" cy="30%" r="85%">
              <stop offset="0%" stopColor="#1E4430" stopOpacity="0.95" />
              <stop offset="48%" stopColor="#122A1E" stopOpacity="0.98" />
              <stop offset="100%" stopColor="#0B1A12" stopOpacity="1" />
            </radialGradient>

            <radialGradient id="tp-globe-rim-pista" cx="50%" cy="50%" r="50%">
              <stop offset="88%" stopColor="#2D6A4F" stopOpacity="0" />
              <stop offset="97%" stopColor="#52B788" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#74C69D" stopOpacity="0.15" />
            </radialGradient>

            <filter id="tp-globe-atmo-blur" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="5" />
            </filter>

            <filter id="tp-tricolor-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Outer Atmosphere Glow */}
          <circle
            className="tp-globe-atmo"
            cx={CX}
            cy={CY}
            r={R + 3}
            filter="url(#tp-globe-atmo-blur)"
          />

          {/* Globe Sphere */}
          <circle cx={CX} cy={CY} r={R} fill="url(#tp-globe-shade-pista)" />
          <circle className="tp-globe-rim" cx={CX} cy={CY} r={R} fill="url(#tp-globe-rim-pista)" />

          {/* Dot Matrix Surface with India Centered at CX, CY */}
          <g className="tp-globe-surface">
            {dots.map((d, i) => {
              const isIndiaHighlight = introState === 'locked' && d.inIndia;
              const fill = isIndiaHighlight
                ? d.tricolor
                : d.land
                ? '#52B788'
                : 'rgba(82, 183, 136, 0.15)';

              return (
                <circle
                  key={i}
                  cx={d.x}
                  cy={d.y}
                  r={isIndiaHighlight ? 1.7 + d.z * 1.5 : d.land ? 0.95 + d.z * 1.25 : 0.45 + d.z * 0.4}
                  fill={fill}
                  className={d.land ? 'is-land' : 'is-grid'}
                  opacity={isIndiaHighlight ? 0.95 : d.land ? 0.4 + d.z * 0.58 : 0.08 + d.z * 0.15}
                  filter={isIndiaHighlight ? 'url(#tp-tricolor-glow)' : undefined}
                />
              );
            })}
          </g>

          {/* Event Markers */}
          <g className="tp-globe-markers">
            {surfaceMarkers.filter(d => d.visible).map((d, i) => (
              <g key={i}>
                <circle
                  cx={d.x}
                  cy={d.y}
                  r={d.fail ? 5 : 3.5}
                  fill={d.fill}
                  opacity={0.3}
                />
                <circle
                  cx={d.x}
                  cy={d.y}
                  r={d.fail ? 2.8 : 2}
                  fill={d.fill}
                  opacity={Math.min(1, 0.65 + d.z * 0.35)}
                >
                  <title>{d.label}</title>
                </circle>
              </g>
            ))}
          </g>

          {/* Concentric Tricolor Ripples Radiating from India Center (CX, CY) */}
          {introState === 'locked' && (
            <g className="aiori-india-pulse" key={pulseCount}>
              {/* Saffron Ripple */}
              <circle cx={CX} cy={CY} r={18} fill="none" stroke="#FF9933" strokeWidth="2.2" className="ripple-saffron" />
              {/* White Ripple */}
              <circle cx={CX} cy={CY} r={13} fill="none" stroke="#FFFFFF" strokeWidth="1.8" className="ripple-white" />
              {/* India Green Ripple */}
              <circle cx={CX} cy={CY} r={8} fill="none" stroke="#138808" strokeWidth="2.4" className="ripple-green" />
              {/* Ashoka Navy Blue Center Pin */}
              <circle cx={CX} cy={CY} r={3.4} fill="#0A2351" stroke="#FFFFFF" strokeWidth="1.2" className="center-chakra-dot" />
            </g>
          )}
        </svg>
      </div>
    </figure>
  );
}

const MemoizedEvidenceGlobe = memo(EvidenceGlobe);
export default MemoizedEvidenceGlobe;
