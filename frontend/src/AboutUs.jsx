import React, { useRef, useEffect } from 'react';
import {
  ArrowUpRight,
  Mail,
  Play,
  Activity,
  Sparkles
} from 'lucide-react';
import './styles/AboutUs.css';

function GithubIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  );
}

function LinkedinIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}

/**
 * 3D Tilt / Parallax Mouse-Tracking Card Component
 * Uses direct DOM manipulation via requestAnimationFrame for silky 60/120fps with 0 React re-renders.
 */
function TiltCard({ children, className = '', style = {}, maxTilt = 12, maxTranslate = 5, scale = 1.025 }) {
  const cardRef = useRef(null);
  const glareRef = useRef(null);
  const rafId = useRef(null);
  const boundsRef = useRef(null);

  useEffect(() => {
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, []);

  const updateBounds = () => {
    if (cardRef.current) {
      boundsRef.current = cardRef.current.getBoundingClientRect();
    }
  };

  const handleMouseMove = (e) => {
    if (!cardRef.current) return;
    if (!boundsRef.current) updateBounds();
    const rect = boundsRef.current;
    if (!rect || rect.width === 0 || rect.height === 0) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    // Normalized offset from -1 to 1
    const percentX = Math.max(-1, Math.min(1, (x - centerX) / centerX));
    const percentY = Math.max(-1, Math.min(1, (y - centerY) / centerY));

    // Horizontal-only 3D tilt: face rotates ONLY right and left (rotateY), NOT up and down (rotateX = 0)
    const rotX = 0;
    const rotY = percentX * maxTilt;

    // Subtle horizontal translation follow (no vertical offset)
    const transX = percentX * maxTranslate;
    const transY = 0;

    // Dynamic specular glare coordinates (tracks cursor horizontally across card)
    const glareX = (x / rect.width) * 100;
    const glareY = 50; // Centered vertically for a clean horizontal specular sweep

    cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      if (!cardRef.current) return;
      cardRef.current.style.setProperty('transition', 'transform 0.08s ease-out, box-shadow 0.15s ease-out, border-color 0.2s ease');
      cardRef.current.style.setProperty(
        'transform',
        `perspective(1000px) rotateX(0deg) rotateY(${rotY.toFixed(2)}deg) translate3d(${transX.toFixed(1)}px, 0px, 0) scale3d(${scale}, ${scale}, ${scale})`,
        'important'
      );

      // Reactive drop shadow shifting horizontally opposite the tilt angle
      const shadowX = (-rotY * 1.6).toFixed(1);
      cardRef.current.style.setProperty(
        'box-shadow',
        `${shadowX}px 14px 32px -8px rgba(99, 102, 241, 0.22), 0 4px 12px rgba(0, 0, 0, 0.05)`,
        'important'
      );

      if (glareRef.current) {
        glareRef.current.style.opacity = '1';
        glareRef.current.style.background = `radial-gradient(circle at ${glareX.toFixed(1)}% 50%, rgba(99, 102, 241, 0.12) 0%, rgba(168, 85, 247, 0.05) 35%, transparent 70%)`;
      }
    });
  };

  const handleMouseEnter = () => {
    updateBounds();
    if (!cardRef.current) return;
    cardRef.current.style.setProperty('transition', 'transform 0.15s ease-out, box-shadow 0.2s ease-out, border-color 0.2s ease');
    if (glareRef.current) {
      glareRef.current.style.opacity = '1';
    }
  };

  const handleMouseLeave = () => {
    cancelAnimationFrame(rafId.current);
    boundsRef.current = null;
    if (!cardRef.current) return;
    cardRef.current.style.setProperty('transition', 'transform 0.55s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.55s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease');
    cardRef.current.style.setProperty('transform', 'perspective(1000px) rotateX(0deg) rotateY(0deg) translate3d(0, 0, 0) scale3d(1, 1, 1)', 'important');
    cardRef.current.style.removeProperty('box-shadow');
    if (glareRef.current) {
      glareRef.current.style.opacity = '0';
    }
  };

  return (
    <article
      ref={cardRef}
      className={`tp-team-card tp-tilt-card ${className}`}
      style={style}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="tp-tilt-glare" ref={glareRef} aria-hidden="true" />
      {children}
    </article>
  );
}

export default function AboutUs() {
  const videoRef = useRef(null);

  const handleExternalClick = (url) => (e) => {
    e.stopPropagation();
    if (e.button === 0) {
      e.preventDefault();
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  useEffect(() => {
    // Autostart video on every page mount / reload
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Fallback to muted autoplay if browser policy blocks initial audio
          if (videoRef.current) {
            videoRef.current.muted = true;
            videoRef.current.play().catch(() => {});
          }
        });
      }
    }
  }, []);

  return (
    <div className="tp-about-page">
      {/* ---------------------------------------------------------------------
          Hero Header (InvertisPrep-style)
          --------------------------------------------------------------------- */}
      <header className="tp-about-hero tp-scroll-reveal">
        <div className="tp-about-eyebrow">
          <span>🇮🇳</span> AIORI-3 · HACKATHON TEAM
        </div>
        <h1>
          The people who <span className="tp-about-accent">set the direction</span>
        </h1>
        <p>
          Students themselves — deciding what gets engineered, maintaining cryptographic custody,
          and holding the bar for how it ships.
        </p>
      </header>

      {/* ---------------------------------------------------------------------
          Team Members Grid (Compact 2-Column Side-by-Side Cards with 3D Tilt)
          --------------------------------------------------------------------- */}
      <section className="tp-team-grid" aria-label="Core Team Members">
        {/* Member 1: Aditi Shukla */}
        <TiltCard style={{ '--card-idx': 0 }}>
          <div className="tp-team-photo-wrap">
            <a
              href="https://www.linkedin.com/in/aditishukla40"
              target="_blank"
              rel="noopener noreferrer"
              className="tp-team-card-link-badge"
              title="View Aditi's LinkedIn Profile"
              aria-label="View Aditi's LinkedIn Profile"
              onClick={handleExternalClick('https://www.linkedin.com/in/aditishukla40')}
            >
              <ArrowUpRight size={16} />
            </a>

            <img
              src="/aditi-shukla.jpg"
              alt="Aditi Shukla"
              className="tp-team-photo"
              loading="lazy"
            />
          </div>

          <div className="tp-team-content">
            <span className="tp-team-role-pill">
              <Sparkles size={12} /> Founder & Lead
            </span>
            <h2 className="tp-team-name">Aditi Shukla</h2>
            <div className="tp-team-tagline">
              Forensic architecture, cryptographic verification, and system design.
            </div>
            <p className="tp-team-bio">
              Engineered TracePoint's immutable SHA-256 genesis-chained custody ledger, end-to-end
              RFC 5424 normalization, and national telemetry pipeline for legally defensible incident response.
            </p>

            <div className="tp-team-skills">
              <span className="tp-team-skill-pill">Cryptographic custody</span>
              <span className="tp-team-skill-pill">System architecture</span>
              <span className="tp-team-skill-pill">RFC 5424 parsing</span>
              <span className="tp-team-skill-pill">Security research</span>
            </div>

            <div className="tp-team-footer">
              <div className="tp-team-socials">
                <a
                  href="https://github.com/aditishukla297"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tp-team-social-btn"
                  title="GitHub Profile (aditishukla297)"
                  aria-label="GitHub Profile"
                  onClick={handleExternalClick('https://github.com/aditishukla297')}
                >
                  <GithubIcon size={14} />
                </a>
                <a
                  href="https://www.linkedin.com/in/aditishukla40"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tp-team-social-btn"
                  title="LinkedIn Profile"
                  aria-label="LinkedIn Profile"
                  onClick={handleExternalClick('https://www.linkedin.com/in/aditishukla40')}
                >
                  <LinkedinIcon size={14} />
                </a>
                <a
                  href="https://mail.google.com/mail/?view=cm&fs=1&to=aditishukla29700@gmail.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tp-team-social-btn"
                  title="Email via Gmail (aditishukla29700@gmail.com)"
                  aria-label="Email Aditi Shukla via Gmail"
                  onClick={handleExternalClick('https://mail.google.com/mail/?view=cm&fs=1&to=aditishukla29700@gmail.com')}
                >
                  <Mail size={14} />
                </a>
              </div>

              <a
                href="https://www.linkedin.com/in/aditishukla40"
                target="_blank"
                rel="noopener noreferrer"
                className="tp-team-profile-link"
                onClick={handleExternalClick('https://www.linkedin.com/in/aditishukla40')}
              >
                <span>Full profile</span>
                <ArrowUpRight size={12} />
              </a>
            </div>
          </div>
        </TiltCard>

        {/* Member 2: Sujal Pathak */}
        <TiltCard style={{ '--card-idx': 1 }}>
          <div className="tp-team-photo-wrap">
            <a
              href="https://www.linkedin.com/in/prince-yadav-794706325/"
              target="_blank"
              rel="noopener noreferrer"
              className="tp-team-card-link-badge"
              title="View Sujal's LinkedIn Profile"
              aria-label="View Sujal's LinkedIn Profile"
              onClick={handleExternalClick('https://www.linkedin.com/in/prince-yadav-794706325/')}
            >
              <ArrowUpRight size={16} />
            </a>

            <img
              src="/prince-yadav.jpg"
              alt="Sujal Pathak"
              className="tp-team-photo"
              loading="lazy"
            />
          </div>

          <div className="tp-team-content">
            <span className="tp-team-role-pill prince">
              <Activity size={12} /> Core Systems & Ingestion
            </span>
            <h2 className="tp-team-name">Sujal Pathak</h2>
            <div className="tp-team-tagline">
              Pipeline orchestration, real-time telemetry, and attack graph modeling.
            </div>
            <p className="tp-team-bio">
              Leads high-throughput log ingestion streaming, cross-timezone clock skew reconciliation,
              and multi-hop investigation graph modeling for national infrastructure security telemetry.
            </p>

            <div className="tp-team-skills">
              <span className="tp-team-skill-pill">Investigation graph</span>
              <span className="tp-team-skill-pill">Topology RCA</span>
              <span className="tp-team-skill-pill">Ingestion lab</span>
              <span className="tp-team-skill-pill">Real-time telemetry</span>
            </div>

            <div className="tp-team-footer">
              <div className="tp-team-socials">
                <a
                  href="https://github.com/princeyadav-oss"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tp-team-social-btn"
                  title="GitHub Profile"
                  aria-label="GitHub Profile"
                  onClick={handleExternalClick('https://github.com/princeyadav-oss')}
                >
                  <GithubIcon size={14} />
                </a>
                <a
                  href="https://www.linkedin.com/in/prince-yadav-794706325/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tp-team-social-btn"
                  title="LinkedIn Profile"
                  aria-label="LinkedIn Profile"
                  onClick={handleExternalClick('https://www.linkedin.com/in/prince-yadav-794706325/')}
                >
                  <LinkedinIcon size={14} />
                </a>
                <a
                  href="https://mail.google.com/mail/?view=cm&fs=1&to=py4149560@gmail.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tp-team-social-btn"
                  title="Email via Gmail (py4149560@gmail.com)"
                  aria-label="Email Sujal Pathak via Gmail"
                  onClick={handleExternalClick('https://mail.google.com/mail/?view=cm&fs=1&to=py4149560@gmail.com')}
                >
                  <Mail size={14} />
                </a>
              </div>

              <a
                href="https://www.linkedin.com/in/prince-yadav-794706325/"
                target="_blank"
                rel="noopener noreferrer"
                className="tp-team-profile-link prince"
                onClick={handleExternalClick('https://www.linkedin.com/in/prince-yadav-794706325/')}
              >
                <span>Full profile</span>
                <ArrowUpRight size={12} />
              </a>
            </div>
          </div>
        </TiltCard>
      </section>

      {/* ---------------------------------------------------------------------
          Video Presentation Section (Compact Framed Player, No Logo Thumbnail)
          --------------------------------------------------------------------- */}
      <section className="tp-about-video-section tp-scroll-reveal" aria-label="Tracepoint Video Demonstration">
        <div className="tp-about-video-head">
          <div className="tp-about-video-kicker">
            <Play size={13} fill="#DC2626" /> DEMONSTRATION
          </div>
          <h2>Watch TracePoint in Action</h2>
          <p>
            End-to-end incident investigation and cryptographic custody walkthrough.
          </p>
        </div>

        <div className="tp-video-frame">
          <div className="tp-video-titlebar">
            <div className="tp-video-dots">
              <span />
              <span />
              <span />
            </div>
            <div className="tp-video-title">
              Tracepoint_—_Hackathon_Intro_(1080p).mp4
            </div>
            <div className="tp-video-badge">
              1080p Full HD
            </div>
          </div>

          <div className="tp-video-player-container">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              controls
              preload="auto"
              title="Tracepoint Hackathon Demonstration Video"
            >
              <source src="/tracepoint-intro.mp4" type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          </div>
        </div>
      </section>
    </div>
  );
}
