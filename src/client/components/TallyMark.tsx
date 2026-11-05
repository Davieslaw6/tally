export function TallyMark({ size = 24, title }: { size?: number; title?: string }) {
  return (
    <svg
      className="tally-mark"
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <g stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <path d="M6 6.5v15" />
        <path d="M10.6 6.5v15" />
        <path d="M15.2 6.5v15" />
        <path d="M19.8 6.5v15" />
      </g>
      <path d="M5 22 23 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" className="mark-accent" />
    </svg>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`.trim()} aria-label="TALLY">
      TALLY
    </span>
  );
}
