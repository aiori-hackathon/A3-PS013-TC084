import React from 'react';
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

export default function AboutUs() {
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
          Team Members Grid (Compact 2-Column Side-by-Side Cards)
          --------------------------------------------------------------------- */}
      <section className="tp-team-grid tp-scroll-reveal tp-stagger-parent" aria-label="Core Team Members">
        {/* Member 1: Aditi Shukla */}
        <article className="tp-team-card" style={{ '--card-idx': 0 }}>
          <div className="tp-team-photo-wrap">
            <a
              href="https://www.linkedin.com/in/aditishukla40"
              target="_blank"
              rel="noreferrer"
              className="tp-team-card-link-badge"
              title="View Aditi's LinkedIn Profile"
              aria-label="View Aditi's LinkedIn Profile"
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
                  rel="noreferrer"
                  className="tp-team-social-btn"
                  title="GitHub Profile"
                  aria-label="GitHub Profile"
                >
                  <GithubIcon size={15} />
                </a>
                <a
                  href="https://www.linkedin.com/in/aditishukla40"
                  target="_blank"
                  rel="noreferrer"
                  className="tp-team-social-btn"
                  title="LinkedIn Profile"
                  aria-label="LinkedIn Profile"
                >
                  <LinkedinIcon size={15} />
                </a>
                <a
                  href="mailto:aditishukla29700@gmail.com"
                  className="tp-team-social-btn"
                  title="Email Aditi Shukla"
                  aria-label="Email Aditi Shukla"
                >
                  <Mail size={15} />
                </a>
              </div>

              <a
                href="https://www.linkedin.com/in/aditishukla40"
                target="_blank"
                rel="noreferrer"
                className="tp-team-profile-link"
              >
                <span>Full profile</span>
                <ArrowUpRight size={14} />
              </a>
            </div>
          </div>
        </article>

        {/* Member 2: Prince Yadav */}
        <article className="tp-team-card" style={{ '--card-idx': 1 }}>
          <div className="tp-team-photo-wrap">
            <a
              href="https://www.linkedin.com/in/prince-yadav-794706325/"
              target="_blank"
              rel="noreferrer"
              className="tp-team-card-link-badge"
              title="View Prince's LinkedIn Profile"
              aria-label="View Prince's LinkedIn Profile"
            >
              <ArrowUpRight size={16} />
            </a>

            <img
              src="/prince-yadav.jpg"
              alt="Prince Yadav"
              className="tp-team-photo"
              loading="lazy"
            />
          </div>

          <div className="tp-team-content">
            <span className="tp-team-role-pill prince">
              <Activity size={12} /> Core Systems & Ingestion
            </span>
            <h2 className="tp-team-name">Prince Yadav</h2>
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
                  rel="noreferrer"
                  className="tp-team-social-btn"
                  title="GitHub Profile"
                  aria-label="GitHub Profile"
                >
                  <GithubIcon size={15} />
                </a>
                <a
                  href="https://www.linkedin.com/in/prince-yadav-794706325/"
                  target="_blank"
                  rel="noreferrer"
                  className="tp-team-social-btn"
                  title="LinkedIn Profile"
                  aria-label="LinkedIn Profile"
                >
                  <LinkedinIcon size={15} />
                </a>
                <a
                  href="mailto:py4149560@gmail.com"
                  className="tp-team-social-btn"
                  title="Email Prince Yadav"
                  aria-label="Email Prince Yadav"
                >
                  <Mail size={15} />
                </a>
              </div>

              <a
                href="https://www.linkedin.com/in/prince-yadav-794706325/"
                target="_blank"
                rel="noreferrer"
                className="tp-team-profile-link"
              >
                <span>Full profile</span>
                <ArrowUpRight size={14} />
              </a>
            </div>
          </div>
        </article>
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
              controls
              playsInline
              preload="metadata"
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
