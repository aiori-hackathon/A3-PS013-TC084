import React, { useEffect, useMemo, useRef, useState, useCallback, memo } from 'react';
import { isLand } from './landmask';
import './styles/EvidenceGlobe.css';

/* THE EVIDENCE GLOBE — AIORI-3 CYBER-EMERALD TELEMETRY GLOBE
   ---------------------------------------------------------------------------
   A clean, rotating dot-matrix Earth that decelerates smoothly on mount to
   lock onto India (21.5°N, 78.5°E) with natural tricolor dot illumination.
   Pure, unboxed canvas: zero arbitrary lines, zero cartoon hand graphics.
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
  let index = 0;
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
        if (lat >= 24) tricolor = '#F59E0B'; // Saffron
        else if (lat >= 16.5) tricolor = '#FFFFFF'; // White
        else tricolor = '#10B981'; // India Green
      }

      // Precompute deterministic stream flight parameters for pixel emergence animation
      const s1 = Math.abs((Math.sin(index * 9.17 + 1.23) * 10000) % 1);
      const s2 = Math.abs((Math.sin(index * 13.43 + 4.56) * 10000) % 1);
      const s3 = Math.abs((Math.sin(index * 17.89 + 7.89) * 10000) % 1);

      // Relative vertical position on globe from north (+88) to south (-88)
      const latNorm = (88 - lat) / 176;

      // Start point P0 in the widely expanded top-left region across the hero canvas
      // Spanning from X = -650 to -420, Y = -70 to 180 (covering the hero title & lead area)
      const startX = -600 + (1 - latNorm) * 90 + (s1 - 0.5) * 120;
      const startY = -60 + latNorm * 220 + (s2 - 0.5) * 80;

      // Expanded midpoint P1 (fanning out wide across the hero space as drawn in user diagram)
      const midX = -270 + (1 - latNorm) * 80 + (s2 - 0.5) * 110;
      const midY = -75 + latNorm * 300 + (s3 - 0.5) * 90;

      // Stagger delay so pixels emerge in an organic cascading stream from top-left
      const delay = (s1 * 0.45 + (1 - latNorm) * 0.35 + ((index % 100) / 100) * 0.2) * 950 + s3 * 180;
      const duration = 750 + s2 * 350;

      cells.push({
        lat,
        lon,
        phi,
        land: true,
        inIndia,
        tricolor,
        index,
        startX,
        startY,
        midX,
        midY,
        delay,
        duration,
      });
      index += 1;
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
  replayTrigger = 0,
}) {
  const grid = useMemo(() => buildGrid(), []);

  // Spin & Tilt state
  const [spin, setSpin] = useState((TARGET_SPIN - 120 + 360) % 360);
  const [tilt, setTilt] = useState(0.15);
  const [dragging, setDragging] = useState(false);
  const [introLocked, setIntroLocked] = useState(false);
  const [animElapsed, setAnimElapsed] = useState(0);

  const raf = useRef(0);
  const drag = useRef(null);

  // Smooth Pixel Emergence and Deceleration to India on initial load or replay
  const startEmergenceAnimation = useCallback(() => {
    cancelAnimationFrame(raf.current);
    setIntroLocked(false);
    setAnimElapsed(0);

    const startSpin = (TARGET_SPIN - 120 + 360) % 360;
    const initialTilt = 0.15;
    const deltaSpin = (TARGET_SPIN - startSpin + 720) % 360 + 360;
    const startTime = performance.now();
    const totalDuration = 3200;

    const tick = tNow => {
      const elapsed = tNow - startTime;
      setAnimElapsed(elapsed);

      // Rotation begins at 1100ms as pixels assemble, and smoothly decelerates into TARGET_SPIN by 3200ms
      if (elapsed < 1100) {
        setSpin(startSpin);
        setTilt(initialTilt);
      } else {
        const rotElapsed = elapsed - 1100;
        const pRot = Math.min(1, rotElapsed / 2100);
        const ease = 1 - Math.pow(1 - pRot, 3);
        setSpin((startSpin + deltaSpin * ease) % 360);
        setTilt(initialTilt + (TARGET_TILT - initialTilt) * ease);
      }

      if (elapsed < totalDuration) {
        raf.current = requestAnimationFrame(tick);
      } else {
        setSpin(TARGET_SPIN);
        setTilt(TARGET_TILT);
        setIntroLocked(true);
        setAnimElapsed(totalDuration);
      }
    };

    raf.current = requestAnimationFrame(tick);
  }, []);

  // Run on mount or on replay trigger
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSpin(TARGET_SPIN);
      setTilt(TARGET_TILT);
      setIntroLocked(true);
      setAnimElapsed(999999);
      return undefined;
    }

    const timer = setTimeout(() => {
      startEmergenceAnimation();
    }, 120);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf.current);
    };
  }, [startEmergenceAnimation, replayTrigger]);

  // Pointer drag gestures
  const onPointerDown = e => {
    cancelAnimationFrame(raf.current);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, spin, tilt };
    setDragging(true);
    setIntroLocked(true);
    setAnimElapsed(999999);
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

  // Compute Surface Dots with dynamic Pixel Emergence
  const dots = useMemo(() => {
    const out = [];
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    const isEmerging = animElapsed < 2200 && !dragging;

    for (const c of grid) {
      const theta = ((c.lon + spin) * Math.PI) / 180;
      const x1 = Math.cos(c.phi) * Math.sin(theta);
      const y1 = Math.sin(c.phi);
      const z1 = Math.cos(c.phi) * Math.cos(theta);
      const y2 = y1 * ct - z1 * st;
      const z2 = y1 * st + z1 * ct;

      if (!isEmerging && z2 <= 0.02) continue;

      const targetX = CX + x1 * R;
      const targetY = CY - y2 * R;
      const isIndiaDot = introLocked && c.inIndia;
      const targetRadius = isIndiaDot
        ? 1.9 + Math.max(0, z2) * 1.5
        : 1.15 + Math.max(0, z2) * 1.35;
      const targetOpacity = isIndiaDot
        ? 0.98
        : Math.min(1, 0.65 + Math.max(0, z2) * 0.35);

      if (!isEmerging) {
        out.push({
          x: targetX,
          y: targetY,
          z: z2,
          r: targetRadius,
          opacity: targetOpacity,
          land: c.land,
          inIndia: c.inIndia,
          tricolor: c.tricolor,
        });
      } else {
        const { startX, startY, midX, midY, delay, duration } = c;

        if (animElapsed < delay) {
          // Pixel hasn't launched yet
          continue;
        }

        const flightTime = animElapsed - delay;
        if (flightTime >= duration) {
          // Pixel arrived at target on globe
          if (z2 <= 0.02) continue;
          out.push({
            x: targetX,
            y: targetY,
            z: z2,
            r: targetRadius,
            opacity: targetOpacity,
            land: c.land,
            inIndia: c.inIndia,
            tricolor: c.tricolor,
          });
        } else {
          // Pixel in active flight from expanded top-left area along sweeping Bezier arc
          const p = Math.min(1, flightTime / duration);
          const ease = 1 - Math.pow(1 - p, 3); // smooth quintic ease-out

          // Quadratic Bezier interpolation: (1 - ease)^2 * start + 2*(1 - ease)*ease * mid + ease^2 * target
          const oneMinusE = 1 - ease;
          const curX = oneMinusE * oneMinusE * startX + 2 * oneMinusE * ease * midX + ease * ease * targetX;
          const curY = oneMinusE * oneMinusE * startY + 2 * oneMinusE * ease * midY + ease * ease * targetY;

          const curR = 0.75 + (targetRadius - 0.75) * ease;
          const curOpacity = Math.min(1, p * 2.2) * targetOpacity;

          out.push({
            x: curX,
            y: curY,
            z: z2,
            r: curR,
            opacity: curOpacity,
            land: c.land,
            inIndia: c.inIndia,
            tricolor: c.tricolor,
            isFlying: true,
          });
        }
      }
    }
    return out;
  }, [grid, spin, tilt, animElapsed, dragging, introLocked]);

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

    return {
      markers,
      total: events.length,
      failures,
    };
  }, [events, severityOf, deviceOf, isFailure, timestampOf]);

  const surfaceMarkers = useMemo(() => {
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    return model.markers.map(m => {
      const phi = (m.lat * Math.PI) / 180;
      const theta = ((m.lon + spin) * Math.PI) / 180;
      const x1 = Math.cos(phi) * Math.sin(theta);
      const y1 = Math.sin(phi);
      const z1 = Math.cos(phi) * Math.cos(theta);
      const y2 = y1 * ct - z1 * st;
      const z2 = y1 * st + z1 * ct;
      return {
        ...m,
        x: CX + x1 * (R + 2.5),
        y: CY - y2 * (R + 2.5),
        z: z2,
        visible: z2 > 0.05,
      };
    });
  }, [model.markers, spin, tilt]);

  const empty = model.total === 0;

  return (
    <figure
      className="tp-globe aiori-globe-container"
      data-empty={empty || undefined}
      style={{
        background: 'transparent',
        border: 'none',
        outline: 'none',
        boxShadow: 'none',
        margin: '0 auto',
      }}
    >
      <div
        className="tp-globe-stage"
        style={{
          background: 'transparent',
          border: 'none',
          outline: 'none',
          boxShadow: 'none',
        }}
      >
        <svg
          className="tp-globe-svg aiori-globe-svg"
          viewBox="0 0 420 310"
          role="img"
          tabIndex={-1}
          style={{
            background: 'transparent',
            border: 'none',
            outline: 'none',
            boxShadow: 'none',
          }}
          data-dragging={dragging || undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          aria-label="Interactive AIORI-3 Evidence Globe"
        >
          <defs>
            {/* Luminous Cyber-Emerald Deep Sphere Gradient */}
            <radialGradient id="tp-globe-shade-pista" cx="35%" cy="30%" r="85%">
              <stop offset="0%" stopColor="#1C4B3A" stopOpacity="0.96" />
              <stop offset="55%" stopColor="#123527" stopOpacity="0.98" />
              <stop offset="100%" stopColor="#0A2218" stopOpacity="1" />
            </radialGradient>

            <radialGradient id="tp-globe-rim-pista" cx="50%" cy="50%" r="50%">
              <stop offset="82%" stopColor="#10B981" stopOpacity="0" />
              <stop offset="94%" stopColor="#34D399" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#6EE7B7" stopOpacity="0.75" />
            </radialGradient>

            {/* Top-Left Cyber Emitter Radiant Source */}
            <radialGradient id="tp-emitter-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#34D399" stopOpacity="0.85" />
              <stop offset="35%" stopColor="#10B981" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#0A2218" stopOpacity="0" />
            </radialGradient>

            <filter id="tp-globe-atmo-blur" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="5" />
            </filter>

            <filter id="tp-tricolor-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Sweeping Streamline Arcs across Hero (matching user's expanded emergence flow) */}
          {animElapsed < 2100 && !dragging && (
            <g
              className="aiori-streamline-field"
              opacity={Math.max(0, 1 - animElapsed / 1900) * 0.55}
              style={{ pointerEvents: 'none' }}
            >
              {/* Top Arcing Streamline */}
              <path
                d={`M -540 -50 Q -240 -65 ${CX} ${CY - R + 8}`}
                fill="none"
                stroke="#34D399"
                strokeWidth="1.5"
                strokeDasharray="6 8"
                opacity="0.6"
              />
              {/* Equatorial Streamline */}
              <path
                d={`M -580 55 Q -210 95 ${CX - R + 8} ${CY}`}
                fill="none"
                stroke="#10B981"
                strokeWidth="1.8"
                strokeDasharray="8 10"
                opacity="0.75"
              />
              {/* Lower Southern Streamline */}
              <path
                d={`M -520 160 Q -180 230 ${CX} ${CY + R - 10}`}
                fill="none"
                stroke="#34D399"
                strokeWidth="1.5"
                strokeDasharray="6 8"
                opacity="0.55"
              />
            </g>
          )}

          {/* Outer Atmosphere Glow */}
          <circle
            className="tp-globe-atmo"
            cx={CX}
            cy={CY}
            r={R + 3}
            stroke="#34D399"
            strokeWidth="2.5"
            opacity={animElapsed >= 1800 ? 0.35 : Math.max(0, (animElapsed - 700) / 1100) * 0.35}
            filter="url(#tp-globe-atmo-blur)"
          />

          {/* Globe Sphere Backdrop (Emerges gracefully as pixels assemble) */}
          <circle
            cx={CX}
            cy={CY}
            r={R}
            fill="url(#tp-globe-shade-pista)"
            opacity={animElapsed >= 1800 ? 1 : Math.max(0, (animElapsed - 300) / 1300)}
          />
          <circle
            className="tp-globe-rim"
            cx={CX}
            cy={CY}
            r={R}
            fill="url(#tp-globe-rim-pista)"
            opacity={animElapsed >= 1800 ? 1 : Math.max(0, (animElapsed - 500) / 1200)}
          />

          {/* Dot Matrix Surface with India Centered at CX, CY */}
          <g className="tp-globe-surface">
            {dots.map((d, i) => {
              const isIndiaHighlight = introLocked && d.inIndia;
              const fill = isIndiaHighlight
                ? d.tricolor
                : (d.isFlying ? '#6EE7B7' : '#34D399');

              return (
                <circle
                  key={i}
                  cx={d.x}
                  cy={d.y}
                  r={d.r}
                  fill={fill}
                  className={isIndiaHighlight ? 'is-india' : 'is-land'}
                  opacity={d.opacity}
                  filter={isIndiaHighlight ? 'url(#tp-tricolor-glow)' : undefined}
                />
              );
            })}
          </g>

          {/* Event Markers (Fade in once globe is assembled) */}
          <g
            className="tp-globe-markers"
            opacity={introLocked ? 1 : Math.max(0, (animElapsed - 2200) / 700)}
          >
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

          {/* Clean India Center Telemetry Pin (Zero unnecessary concentric lines) */}
          {introLocked && (
            <g className="aiori-india-beacon">
              <circle
                cx={CX}
                cy={CY}
                r={3.6}
                fill="#10B981"
                stroke="#FFFFFF"
                strokeWidth="1.5"
                className="center-chakra-dot"
              />
            </g>
          )}
        </svg>
      </div>
    </figure>
  );
}

const MemoizedEvidenceGlobe = memo(EvidenceGlobe);
export default MemoizedEvidenceGlobe;
