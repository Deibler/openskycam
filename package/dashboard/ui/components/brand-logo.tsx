import logo from '../brand/logo.svg?raw';

/**
 * Original outlined artwork from openskycam-media-kit; its proportions and spacing stay intact. Inline,
 * so it cannot fail to load (iOS Safari showed the old <img> files as broken images) and takes the text color.
 */
export function BrandLogo({ decorative = false }: { decorative?: boolean }) {
  return (
    <span
      className="brand-logo"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : 'openskycam'}
      aria-hidden={decorative || undefined}
      dangerouslySetInnerHTML={{ __html: logo }}
    />
  );
}
