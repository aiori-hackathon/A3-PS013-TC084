import React, { useEffect, useState, useRef, useCallback } from 'react';
import EvidenceGlobe from './EvidenceGlobe';
import TracepointMark from './TracepointMark';
import './styles/GlobeIntro.css';

/**
 * GlobeIntro — Cinematic 4-Phase Intro Sequence for Hackathon Demonstrations
 *
 * Sequence (~4.6 seconds total):
 * 1. Fullscreen globe (0s–1.2s): Centered spinning globe on clean pistachio #F3F7F4 canvas
 * 2. Satellite orbits (1.2s–2.2s): Radar satellite traverses an elliptical orbit with sage trail
 * 3. India lock-on (2.2s–3.3s): India fills with emerald/tricolor, ripples emanate, coordinates banner pops
 * 4. Settle & reveal (3.3s–4.6s): Globe scales down smoothly into the hero corner, dashboard is revealed
 */
export default function GlobeIntro({
  onComplete,
  events = [],
  severityOf,
  deviceOf,
  isFailure,
  timestampOf,
}) {
  // Phases: 'fullscreen' -> 'orbiting' -> 'india' -> 'settling' -> 'done'
  const [phase, setPhase] = useState('fullscreen');
  const [satelliteAngle, setSatelliteAngle] = useState(0); // 0 to 360 deg
  const animFrame = useRef(null);
  const startTime = useRef(null);

  const handleFinish = useCallback(() => {
    try {
      sessionStorage.setItem('intro-played', 'true');
    } catch {}
    if (onComplete) onComplete();
  }, [onComplete]);

  // Handle keyboard Escape to skip
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        handleFinish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleFinish]);

  // Animation Timeline Controller
  useEffect(() => {
    // Respect prefers-reduced-motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      handleFinish();
      return undefined;
    }

    startTime.current = performance.now();

    // 1. Satellite Orbit & State Timeline
    const tick = (now) => {
      const elapsed = now - startTime.current;

      // Satellite orbital sweep (travels ~360 degrees over 3.2s)
      const orbitProgress = Math.min(1, elapsed / 3400);
      setSatelliteAngle(orbitProgress * 360);

      if (elapsed >= 1000 && elapsed < 2100) {
        setPhase('orbiting');
      } else if (elapsed >= 2100 && elapsed < 3300) {
        setPhase('india');
      } else if (elapsed >= 3300 && elapsed < 4600) {
        setPhase('settling');
      } else if (elapsed >= 4600) {
        setPhase('done');
        handleFinish();
        return;
      }

      animFrame.current = requestAnimationFrame(tick);
    };

    animFrame.current = requestAnimationFrame(tick);

    return () => {
      if (animFrame.current) cancelAnimationFrame(animFrame.current);
    };
  }, [handleFinish]);

  if (phase === 'done') return null;

  // Elliptical Orbit Geometry around Globe center (CX=300, CY=300, a=230, b=96, tilted -18deg)
  const rad = (satelliteAngle * Math.PI) / 180;
  const a = 235; // semi-major axis
  const b = 92;  // semi-minor axis
  const tiltAngle = (-18 * Math.PI) / 180; // orbit inclination

  const unrotatedX = a * Math.cos(rad);
  const unrotatedY = b * Math.sin(rad);

  const satX = 300 + (unrotatedX * Math.cos(tiltAngle) - unrotatedY * Math.sin(tiltAngle));
  const satY = 300 + (unrotatedX * Math.sin(tiltAngle) + unrotatedY * Math.cos(tiltAngle));

  // Satellite depth flag: when sin(rad) > 0, satellite is in foreground of globe
  const isForeground = Math.sin(rad) >= -0.15;

  return (
    <div
      className={`tp-globe-intro-overlay ${phase === 'settling' ? 'is-settling' : ''}`}
      role="region"
      aria-label="Tracepoint Intro Animation"
    >
      {/* Top Left Watermark */}
      <div className="tp-globe-intro-watermark">
        <div className="tp-globe-intro-logo">
          <TracepointMark size={28} />
          <span className="tp-globe-intro-logo-text">Tracepoint</span>
        </div>
        <div className="tp-globe-intro-badge">
          <span>🇮🇳</span> AIORI-3 · NATIONAL TELEMETRY HUB
        </div>
      </div>

      {/* Top Right Skip Button */}
      <button
        type="button"
        className="tp-globe-intro-skip"
        onClick={handleFinish}
        title="Skip intro and view dashboard (Esc)"
      >
        <span>Skip intro</span>
        <span aria-hidden="true">→</span>
      </button>

      {/* Center Stage: Globe + Orbital Satellite Overlay */}
      <div className="tp-globe-intro-stage">
        <div className="tp-globe-intro-globe-wrap">
          <EvidenceGlobe
            events={events}
            severityOf={severityOf}
            deviceOf={deviceOf}
            isFailure={isFailure}
            timestampOf={timestampOf}
          />

          {/* SVG Orbit Track & Satellite Layer */}
          <svg
            className="tp-globe-intro-orbit-svg"
            viewBox="0 0 600 600"
            aria-hidden="true"
          >
            <defs>
              {/* Gradient for the glowing orbital trail */}
              <linearGradient id="tp-sage-trail-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#25543D" stopOpacity="0" />
                <stop offset="65%" stopColor="#25543D" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#34D399" stopOpacity="0.95" />
              </linearGradient>

              {/* Satellite Glow Filter */}
              <filter id="tp-sat-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Elliptical Orbital Ring Track */}
            <g transform="translate(300, 300) rotate(-18)">
              <ellipse
                cx="0"
                cy="0"
                rx={a}
                ry={b}
                className="tp-orbit-track"
              />
            </g>

            {/* Pulsing India Zenith Rings when Locked */}
            {(phase === 'india' || phase === 'settling') && (
              <g transform="translate(300, 275)">
                <circle cx="0" cy="0" r="12" fill="none" stroke="#34D399" className="tp-india-zenith-pulse" />
                <circle cx="0" cy="0" r="24" fill="none" stroke="#FF9933" strokeDasharray="4 3" opacity="0.8" />
                <circle cx="0" cy="0" r="4.5" fill="#138808" stroke="#FFFFFF" strokeWidth="1.5" />
              </g>
            )}

            {/* Orbiting Satellite / Radar Craft */}
            <g
              className="tp-satellite-group"
              transform={`translate(${satX}, ${satY})`}
              opacity={isForeground ? 1 : 0.45}
            >
              {/* Radar Beacon Pulse */}
              <circle cx="0" cy="0" r="14" fill="none" stroke="#34D399" strokeWidth="1.5" opacity="0.6">
                <animate attributeName="r" values="8;20" dur="1.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.8;0" dur="1.2s" repeatCount="indefinite" />
              </circle>

              {/* Satellite Body & Solar Panels */}
              <g transform="rotate(45)" filter="url(#tp-sat-glow)">
                {/* Left Solar Panel */}
                <rect x="-18" y="-4" width="10" height="8" rx="1.5" fill="#25543D" stroke="#52B788" strokeWidth="0.8" />
                <line x1="-13" y1="-4" x2="-13" y2="4" stroke="#74C69D" strokeWidth="0.6" />
                {/* Center Instrument Pod */}
                <rect x="-6" y="-5" width="12" height="10" rx="2" fill="#13281E" stroke="#FFFFFF" strokeWidth="1" />
                {/* Sensor Lens */}
                <circle cx="0" cy="0" r="2.8" fill="#34D399" />
                {/* Right Solar Panel */}
                <rect x="8" y="-4" width="10" height="8" rx="1.5" fill="#25543D" stroke="#52B788" strokeWidth="0.8" />
                <line x1="13" y1="-4" x2="13" y2="4" stroke="#74C69D" strokeWidth="0.6" />
              </g>
            </g>
          </svg>
        </div>
      </div>

      {/* Telemetry Lock Banner (Appears on Phase 'india') */}
      <div className="tp-globe-intro-banner">
        {(phase === 'india' || phase === 'settling') ? (
          <div className="tp-globe-intro-lock-pill">
            <span className="tp-globe-intro-lock-dot" />
            <span className="tp-globe-intro-coords">LOCKED ON INDIA (21.5°N, 78.5°E)</span>
          </div>
        ) : (
          <div className="tp-globe-intro-sub">
            ESTABLISHING ORBITAL TELEMETRY LINK…
          </div>
        )}
      </div>
    </div>
  );
}
