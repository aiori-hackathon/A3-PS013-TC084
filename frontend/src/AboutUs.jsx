import React from 'react';
import {
  ArrowUpRight,
  Mail,
  ShieldCheck,
  Cpu,
  GitBranch,
  FileCheck2,
  Camera,
  Play,
  Activity,
  Layers,
  Sparkles,
  ExternalLink
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

export default function AboutUs({ onNavigate }) {
  return (
    <div className="tp-about-page">
      {/* ---------------------------------------------------------------------
          Hero Header (InvertisPrep-style)
          --------------------------------------------------------------------- */}
      <header className="tp-about-hero tp-scroll-reveal">
        <div className="tp-about-eyebrow">
          <span>🇮🇳</span> AIORI-3 · NATIONAL CYBER DEFENSE HACKATHON
        </div>
        <h1>
          The people who <span className="tp-about-accent">set the direction</span>
        </h1>
        <p>
          Students and builders — deciding what gets engineered, maintaining cryptographic custody,
          and holding the bar for how defensible forensic software ships.
        </p>
      </header>

      {/* ---------------------------------------------------------------------
          Team Members List (InvertisPrep Card UI)
          --------------------------------------------------------------------- */}
      <section className="tp-team-list tp-scroll-reveal tp-stagger-parent" aria-label="Core Team Members">
        {/* 1. Member 1: Aditi Shukla */}
        <article className="tp-team-card" style={{ '--card-idx': 0 }}>
          {/* Left Photo Slot */}
          <div className="tp-team-photo-wrap">
            <a
              href="https://github.com/aditishukla297"
              target="_blank"
              rel="noreferrer"
              className="tp-team-card-link-badge"
              title="View Aditi's GitHub"
              aria-label="View Aditi's GitHub"
            >
              <ArrowUpRight size={18} />
            </a>

            {/* Photo Placeholder Frame (Empty until photo is provided) */}
            <div className="tp-team-placeholder">
              <div className="tp-team-avatar-circle">
                AS
              </div>
              <span className="tp-team-placeholder-badge">
                <Camera size={13} /> Photo Placeholder
              </span>
              <span className="tp-team-placeholder-note">
                Member 1 · Photograph slot ready
              </span>
            </div>
          </div>

          {/* Right Content */}
          <div className="tp-team-content">
            <span className="tp-team-role-pill">
              <Sparkles size={13} /> Founder & Lead Architect
            </span>
            <h2 className="tp-team-name">Aditi Shukla</h2>
            <div className="tp-team-tagline">
              Forensic architecture, cryptographic verification, and system design.
            </div>
            <p className="tp-team-bio">
              Aditi Shukla engineered the core architecture behind TracePoint to solve a fundamental
              deficiency in enterprise and national incident response: raw machine logs are siloed,
              timestamps drift across nodes, and evidence lacks tamper-evident legal proof. As Lead Architect,
              she designed TracePoint's immutable SHA-256 genesis-chained custody ledger, strict RFC 5424 event
              normalization pipelines, and zero-privilege-escalation telemetry models. She coordinates system
              architecture, cryptographic seals, and core forensic engine reliability.
            </p>

            <div className="tp-team-skills">
              <span className="tp-team-skill-pill">Cryptographic custody</span>
              <span className="tp-team-skill-pill">System architecture</span>
              <span className="tp-team-skill-pill">RFC 5424 parsing</span>
              <span className="tp-team-skill-pill">Security research</span>
              <span className="tp-team-skill-pill">Distributed telemetry</span>
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
                  <GithubIcon size={16} />
                </a>
                <a
                  href="https://linkedin.com"
                  target="_blank"
                  rel="noreferrer"
                  className="tp-team-social-btn"
                  title="LinkedIn Profile"
                  aria-label="LinkedIn Profile"
                >
                  <LinkedinIcon size={16} />
                </a>
                <a
                  href="mailto:aditishukla29700@gmail.com"
                  className="tp-team-social-btn"
                  title="Email Aditi Shukla"
                  aria-label="Email Aditi Shukla"
                >
                  <Mail size={16} />
                </a>
              </div>

              <a
                href="https://github.com/aditishukla297"
                target="_blank"
                rel="noreferrer"
                className="tp-team-profile-link"
              >
                <span>Full profile</span>
                <ArrowUpRight size={15} />
              </a>
            </div>
          </div>
        </article>

        {/* 2. Member 2: Prince Yadav */}
        <article className="tp-team-card" style={{ '--card-idx': 1 }}>
          {/* Left Photo Slot */}
          <div className="tp-team-photo-wrap">
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="tp-team-card-link-badge"
              title="View Prince's Profile"
              aria-label="View Prince's Profile"
            >
              <ArrowUpRight size={18} />
            </a>

            {/* Photo Placeholder Frame (Empty until photo is provided) */}
            <div className="tp-team-placeholder">
              <div className="tp-team-avatar-circle prince">
                PY
              </div>
              <span className="tp-team-placeholder-badge">
                <Camera size={13} /> Photo Placeholder
              </span>
              <span className="tp-team-placeholder-note">
                Member 2 · Photograph slot ready
              </span>
            </div>
          </div>

          {/* Right Content */}
          <div className="tp-team-content">
            <span className="tp-team-role-pill prince">
              <Activity size={13} /> Core Systems & Ingestion Engineer
            </span>
            <h2 className="tp-team-name">Prince Yadav</h2>
            <div className="tp-team-tagline">
              Pipeline orchestration, real-time telemetry, and attack graph modeling.
            </div>
            <p className="tp-team-bio">
              Prince Yadav spearheads ingestion pipeline throughput, network topology root-cause
              analysis (RCA), and multi-hop investigation graph modeling for TracePoint. He specializes in
              high-performance log batch streaming, cross-timezone timestamp skew reconciliation, and
              crafting responsive analyst workspaces for incident response teams evaluating critical national
              infrastructure telemetry.
            </p>

            <div className="tp-team-skills">
              <span className="tp-team-skill-pill">Investigation graph</span>
              <span className="tp-team-skill-pill">Topology RCA</span>
              <span className="tp-team-skill-pill">Log ingestion lab</span>
              <span className="tp-team-skill-pill">Real-time telemetry</span>
              <span className="tp-team-skill-pill">Cross-platform agents</span>
            </div>

            <div className="tp-team-footer">
              <div className="tp-team-socials">
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noreferrer"
                  className="tp-team-social-btn"
                  title="GitHub Profile"
                  aria-label="GitHub Profile"
                >
                  <GithubIcon size={16} />
                </a>
                <a
                  href="https://linkedin.com"
                  target="_blank"
                  rel="noreferrer"
                  className="tp-team-social-btn"
                  title="LinkedIn Profile"
                  aria-label="LinkedIn Profile"
                >
                  <LinkedinIcon size={16} />
                </a>
                <a
                  href="mailto:contact@tracepoint.in"
                  className="tp-team-social-btn"
                  title="Email Prince Yadav"
                  aria-label="Email Prince Yadav"
                >
                  <Mail size={16} />
                </a>
              </div>

              <a
                href="https://github.com"
                target="_blank"
                rel="noreferrer"
                className="tp-team-profile-link"
              >
                <span>Full profile</span>
                <ArrowUpRight size={15} />
              </a>
            </div>
          </div>
        </article>
      </section>

      {/* ---------------------------------------------------------------------
          About TracePoint Platform Section
          --------------------------------------------------------------------- */}
      <section className="tp-about-tracepoint-section tp-scroll-reveal" aria-label="About Tracepoint Platform">
        <div className="tp-about-tracepoint-header">
          <div className="tp-about-tracepoint-kicker">
            <ShieldCheck size={14} /> NATIONAL CYBERSECURITY INVESTIGATION PROTOTYPE
          </div>
          <h2>About Tracepoint · AIORI-3</h2>
          <p>
            TracePoint is an advanced cybersecurity investigation workstation and national internet telemetry
            hub engineered for the AIORI Hackathon. Built from first principles to guarantee courtroom-grade
            legal defensibility, TracePoint bridges the critical gap between raw distributed machine logs and
            auditable incident dossiers.
          </p>
        </div>

        <div className="tp-about-pillars tp-stagger-parent">
          <div className="tp-about-pillar" style={{ '--card-idx': 0 }}>
            <div className="tp-about-pillar-top">
              <span className="tp-about-pillar-icon">
                <ShieldCheck size={18} />
              </span>
              <strong>Cryptographic Chain of Custody</strong>
            </div>
            <p>
              Every ingested byte sequence is sealed with SHA-256 and immutably appended to a hash-chained ledger
              anchored by a genesis seal, making retroactive evidence modification mathematically impossible.
            </p>
          </div>

          <div className="tp-about-pillar" style={{ '--card-idx': 1 }}>
            <div className="tp-about-pillar-top">
              <span className="tp-about-pillar-icon">
                <Cpu size={18} />
              </span>
              <strong>Multi-Source RFC 5424 Normalization</strong>
            </div>
            <p>
              Ingests raw Linux auth.log, macOS Unified Logs, and Windows Event Logs with zero silent data drops,
              exposing parsing gaps as explicit evidence rather than discarding malformed lines.
            </p>
          </div>

          <div className="tp-about-pillar" style={{ '--card-idx': 2 }}>
            <div className="tp-about-pillar-top">
              <span className="tp-about-pillar-icon">
                <GitBranch size={18} />
              </span>
              <strong>Topology RCA & Attack Graph</strong>
            </div>
            <p>
              Correlates authentication anomalies, privilege escalation bursts, and isolated link failures into
              an interactive multi-hop graph to pinpoint true root causes in seconds.
            </p>
          </div>

          <div className="tp-about-pillar" style={{ '--card-idx': 3 }}>
            <div className="tp-about-pillar-top">
              <span className="tp-about-pillar-icon">
                <FileCheck2 size={18} />
              </span>
              <strong>Statutory Incident Dossiers</strong>
            </div>
            <p>
              Generates comprehensive PDF reports with full cryptographic verification proofs, timestamps,
              analyst notes, and linked evidence items ready for executive and statutory presentation.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------------
          Video Presentation Section ("Watch TracePoint in Action")
          --------------------------------------------------------------------- */}
      <section className="tp-about-video-section tp-scroll-reveal" aria-label="Tracepoint Video Demonstration">
        <div className="tp-about-video-head">
          <div className="tp-about-video-kicker">
            <Play size={14} fill="#DC2626" /> OFFICIAL HACKATHON DEMONSTRATION
          </div>
          <h2>Watch TracePoint in Action</h2>
          <p>
            Experience the complete end-to-end walkthrough: from live log ingestion on AWS EC2 nodes to
            cryptographic custody verification, timeline telemetry filtering, and incident investigation.
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
              poster="/tracepoint-logo.png"
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
