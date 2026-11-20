// TRACEPOINT_LAZY_PAGE_V1
// Each workspace is code-split, so its bundle is fetched the first time it is
// opened. Vite fingerprints those files and removes the old ones on every
// deploy, so a tab left open across a release asks for a file that no longer
// exists. Suspense alone has no answer for that: the import rejects, the
// fallback never resolves, and the page shows "Loading…" until someone gives
// up. This catches the failure and says what to do about it.

import { Component, Suspense, useEffect, useRef } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import "./styles/Custody.css";

class PageErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error(`Tracepoint: the ${this.props.name} page failed to load.`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="tp-card tp-page-error" role="alert">
        <TriangleAlert size={26} />
        <strong>{this.props.name} could not be loaded</strong>
        <p>
          This usually means the app was updated while the page was open, so
          part of it is no longer available. Reloading fetches the current
          version. No collected evidence is affected.
        </p>
        <button
          type="button"
          className="tp-button"
          onClick={() => window.location.reload()}
        >
          <RefreshCw size={16} /> Reload the page
        </button>
      </div>
    );
  }
}

function LazyMountNotifier({ name, children }) {
  const ref = useRef(null);

  useEffect(() => {
    // When code-split chunks finish loading and mount, immediately reveal all
    // animated containers so lazy views are never left at opacity 0.
    const reveal = () => {
      if (!ref.current) return;
      const elements = ref.current.querySelectorAll(
        '.tp-scroll-reveal, .tp-reveal-up, .tp-reveal-left, .tp-reveal-right, .tp-reveal-scale, .tp-stagger-parent'
      );
      elements.forEach(el => {
        el.classList.add('tp-in-view');
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('tp-view-mounted', { detail: { name } }));
      }
    };

    reveal();
    const t1 = setTimeout(reveal, 40);
    const t2 = setTimeout(reveal, 180);
    const t3 = setTimeout(reveal, 450);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [name]);

  return <div ref={ref} className="tp-lazy-container" style={{ width: '100%' }}>{children}</div>;
}

export default function LazyPage({ name, children }) {
  return (
    <PageErrorBoundary name={name}>
      <Suspense
        fallback={<div className="tp-empty" role="status">Loading {name}…</div>}
      >
        <LazyMountNotifier name={name}>
          {children}
        </LazyMountNotifier>
      </Suspense>
    </PageErrorBoundary>
  );
}
