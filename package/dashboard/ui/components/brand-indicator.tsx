import mark from '../brand/indicator.svg?raw';
import '../brand/indicator.css';

/** Trusted, local SVG derived from the kit. Status text belongs to the caller. */
export function BrandIndicator({
  state = 'loading',
  size = 'inline',
}: {
  state?: 'loading' | 'live' | 'idle';
  size?: 'inline' | 'player';
}) {
  return (
    <span
      className={`brand-signal brand-signal--${state} brand-signal--${size}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: mark }}
    />
  );
}

export function LoadingStatus({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" className={`loading-status ${className}`}>
      <BrandIndicator />
      <span>{children}</span>
    </div>
  );
}
