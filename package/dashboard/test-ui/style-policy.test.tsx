import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RemoveScrollBar } from 'react-remove-scroll-bar';
import { BrandLogo } from '../ui/components/brand-logo';

afterEach(cleanup);
it('allows only the exact Radix scroll-lock stylesheet used by the fixed viewport', async () => {
  // The app's root has zero margins and no page scrollbar at every breakpoint.
  document.body.style.margin = '0px';
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: window.innerWidth });
  await act(async () => {
    render(createElement(RemoveScrollBar));
  });
  const css = [...document.head.querySelectorAll('style')]
    .map(style => style.textContent)
    .find(text => text?.includes('data-scroll-locked'));
  expect(css).toBeTruthy();
  const hash = createHash('sha256').update(css!).digest('base64');
  const policy = readFileSync('ui/public/_headers', 'utf8');
  expect(policy).toContain(`'sha256-${hash}'`);
  expect(policy).not.toContain("'unsafe-inline'");
});

it('draws the brand inline, in presentation attributes the policy allows rather than style attributes it blocks', () => {
  for (const file of readdirSync('ui/brand').filter(name => name.endsWith('.svg')))
    expect(readFileSync(`ui/brand/${file}`, 'utf8'), file).not.toMatch(/\sstyle=/);
  const { container } = render(createElement(BrandLogo));
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('svg circle[fill="none"][stroke-width]')).toBeTruthy();
});

it('keeps hover styles to devices that hover, so a tap on a phone neither sticks them on nor costs a second tap', () => {
  const sheets = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? sheets(join(dir, entry.name)) : entry.name.endsWith('.css') ? [join(dir, entry.name)] : [],
    );
  for (const file of sheets('ui')) {
    let css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // Drop each @media (hover: hover) block, braces balanced; what remains must not style :hover.
    for (let at = css.search(/@media \(hover: ?hover\)/); at >= 0; at = css.search(/@media \(hover: ?hover\)/)) {
      let depth = 0,
        end = css.indexOf('{', at);
      for (; end < css.length; end++) {
        if (css[end] === '{') depth++;
        else if (css[end] === '}' && --depth === 0) break;
      }
      css = css.slice(0, at) + css.slice(end + 1);
    }
    expect(css.match(/[^{};]*:hover[^{]*/g) ?? [], file).toEqual([]);
  }
});
