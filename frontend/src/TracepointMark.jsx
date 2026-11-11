/* The Tracepoint monogram: a T built from nested rounded squares, with the
   stem running down through them and out of the bottom.

   Drawn as SVG rather than shipped as the supplied raster. The mark appears at
   28px in the header and much larger elsewhere, it has to stay crisp on any
   display, and it has to sit on several different surfaces - so it takes its
   colour from currentColor and carries no background of its own.

   The gaps where the stem crosses the two squares are not drawn as paths. The
   stem is stroked once in the surface colour and filled over the top, which
   knocks a clean channel through whatever it passes in front of. That is why
   --tp-mark-bg exists: it has to match the surface behind the mark, and it
   defaults to the page background. */

export default function TracepointMark({ size = 28, className = '', title }) {
  return (
    <svg
      className={`tp-mark ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={title ? 'img' : 'presentation'}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {/* Outer square */}
      <rect
        x="12" y="8" width="76" height="76" rx="27"
        fill="none" stroke="currentColor" strokeWidth="7.5"
      />
      {/* Inner square */}
      <rect
        x="26.5" y="22.5" width="47" height="47" rx="16.5"
        fill="none" stroke="currentColor" strokeWidth="7.5"
      />
      {/* The crossbar of the T, as the innermost shape */}
      <rect
        x="38" y="34" width="24" height="23" rx="11.5"
        fill="none" stroke="currentColor" strokeWidth="7.5"
      />

      {/* The stem. Stroked in the surface colour first so it cuts a gap
          through everything above, then filled. */}
      <path
        d="M50 40 V96"
        stroke="var(--tp-mark-bg, var(--fx-bg, #090c11))"
        strokeWidth="19"
        strokeLinecap="butt"
        fill="none"
      />
      <path
        d="M50 40 V96"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
