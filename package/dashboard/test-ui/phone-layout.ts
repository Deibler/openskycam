/**
 * jsdom has no layout, so these helpers read the app's own stylesheets for a phone screen: the rules
 * that apply there, the winning declaration for an element, and the boxes of the few absolutely placed
 * pieces of the reviewer (all placed against the full-screen reviewer). Sizes not set in CSS are
 * estimated from text, so these are close, not exact; the screenshots are the visual check.
 */
import { readFileSync } from 'node:fs';

export interface PhoneScreen {
  width: number;
  height: number;
  insets: Record<'top' | 'right' | 'bottom' | 'left', number>;
}
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface Rule {
  selectors: string[];
  style: CSSStyleDeclaration;
  order: number;
  sheet: string;
}
interface Winner {
  value: string;
  sheet: string;
  rank: number[];
}

/** Safari on an iPhone 15, and the same phone from its home screen, where the bars give way to insets. */
export const iphone: PhoneScreen = { width: 390, height: 844, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
export const standalone: PhoneScreen = { ...iphone, insets: { top: 59, right: 0, bottom: 34, left: 0 } };

// The brand colors and the app's stylesheet (which imports them), then the Workshop's in the order
// Workshop.tsx imports them.
const files = [
  'openskycam-media-kit/color/colors.css',
  'ui/styles.css',
  ...['workshop', 'conditions', 'buckets', 'runs', 'review', 'browser', 'reviewer'].map(
    name => `ui/features/workshop/styles/${name}.css`,
  ),
];

/** Splits a selector or argument list on its top-level commas. */
function list(text: string) {
  const parts: string[] = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  return [...parts, text.slice(start).trim()].filter(Boolean);
}

/** Selector specificity as [ids, classes, types]: :is/:not/:has count their most specific argument. */
function specificity(selector: string): number[] {
  const total = [0, 0, 0];
  const add = (s: number[]) => s.forEach((n, i) => (total[i] += n));
  let rest = selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
  rest = rest.replace(/:(?:is|not|has)\(((?:[^()]|\([^()]*\))*)\)/g, (_, args: string) => {
    add(list(args).map(specificity).sort(compare).at(-1) ?? [0, 0, 0]);
    return '';
  });
  total[0] += (rest.match(/#[\w-]+/g) ?? []).length;
  total[1] += (rest.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  total[2] += (rest.match(/(?:^|[\s>+~])[a-z][\w-]*|::[\w-]+/gi) ?? []).length;
  return total;
}
const compare = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Whether a media query list holds on a phone screen with a coarse pointer and no hover. */
function holds(media: string, screen: PhoneScreen) {
  return list(media).some(query =>
    query.split(/\band\b/).every(part => {
      const feature = /\(\s*([a-z-]+)\s*:\s*([a-z0-9.]+)\s*\)/.exec(part);
      if (!feature) return true;
      const [, name, value] = feature,
        n = parseFloat(value);
      if (name === 'max-width') return screen.width <= n;
      if (name === 'min-width') return screen.width >= n;
      if (name === 'max-height') return screen.height <= n;
      if (name === 'min-height') return screen.height >= n;
      if (name === 'pointer') return value === 'coarse';
      if (name === 'hover') return value === 'none';
      if (name === 'orientation') return (value === 'landscape') === screen.width > screen.height;
      return false;
    }),
  );
}

function rules(screen: PhoneScreen) {
  const found: Rule[] = [];
  for (const file of files) {
    const style = document.createElement('style');
    style.textContent = readFileSync(file, 'utf8');
    document.head.append(style);
    const walk = (group: CSSRuleList) => {
      for (const rule of group) {
        if ('selectorText' in rule)
          found.push({
            selectors: list((rule as CSSStyleRule).selectorText),
            style: (rule as CSSStyleRule).style,
            order: found.length,
            sheet: file.split('/').at(-1)!,
          });
        else if ('media' in rule && holds((rule as CSSMediaRule).media.mediaText, screen))
          walk((rule as CSSMediaRule).cssRules);
      }
    };
    walk(style.sheet!.cssRules);
    style.remove();
  }
  return found;
}

/** Reads the stylesheets as they apply on `screen`, for the DOM as it is now: make a new one after it changes. */
export function phoneLayout(screen: PhoneScreen) {
  const all = rules(screen),
    seen = new WeakMap<Element, Map<string, Winner>>();
  const matches = (el: Element, selector: string) => {
    try {
      return el.matches(selector);
    } catch {
      return false;
    }
  };
  /** The winning declaration of each property for an element (inline style first, then the cascade). */
  function declared(el: Element) {
    const known = seen.get(el);
    if (known) return known;
    const won = new Map<string, Winner>();
    seen.set(el, won);
    for (const rule of all) {
      const hit = rule.selectors.filter(s => !s.includes('::') && matches(el, s)).map(specificity);
      if (!hit.length) continue;
      const rank = [...hit.sort(compare).at(-1)!, rule.order];
      for (let i = 0; i < rule.style.length; i++) {
        const prop = rule.style.item(i),
          current = won.get(prop);
        if (
          !current ||
          compare(rank, current.rank) > 0 ||
          (compare(rank, current.rank) === 0 && rank[3] > current.rank[3])
        )
          won.set(prop, { value: rule.style.getPropertyValue(prop).trim(), sheet: rule.sheet, rank });
      }
    }
    const inline = (el as HTMLElement).style;
    for (let i = 0; i < (inline?.length ?? 0); i++)
      won.set(inline.item(i), {
        value: inline.getPropertyValue(inline.item(i)).trim(),
        sheet: 'inline',
        rank: [1, 0, 0, 0],
      });
    return won;
  }
  const get = (el: Element, prop: string) => declared(el).get(prop)?.value;
  /** A custom property as the element inherits it. */
  function custom(el: Element | null, name: string): string | undefined {
    for (let e = el; e; e = e.parentElement) {
      const value = get(e, name);
      if (value !== undefined) return resolve(e, value);
    }
    return undefined;
  }
  /** A value with its var() references filled in. */
  function resolve(el: Element, value: string): string {
    return value.replace(
      /var\((--[\w-]+)(?:,\s*([^)]*))?\)/g,
      (_, name: string, fallback?: string) => custom(el, name) ?? fallback ?? '',
    );
  }
  const shown = (el: Element) => {
    for (let e: Element | null = el; e; e = e.parentElement)
      if (get(e, 'display') === 'none' || e.hasAttribute('hidden') || e.classList.contains('sr-only')) return false;
    return true;
  };
  /** A length in px: px, %, vw, vh, calc() sums and env(safe-area-inset-*). */
  function px(value: string, along: number) {
    const expression = value
      .replace(
        /env\(safe-area-inset-(top|right|bottom|left)\)/g,
        (_, side: keyof PhoneScreen['insets']) => `${screen.insets[side]}px`,
      )
      .replace(/([\d.]+)%/g, (_, n: string) => `${(along * +n) / 100}`)
      .replace(/([\d.]+)vw/g, (_, n: string) => `${(screen.width * +n) / 100}`)
      .replace(/([\d.]+)vh/g, (_, n: string) => `${(screen.height * +n) / 100}`)
      .replace(/px/g, '')
      .replace(/calc/g, '');
    if (!/^[\d.\s+\-*/()]+$/.test(expression)) throw new Error(`Cannot read "${value}" as a length`);
    return Function(`return (${expression})`)() as number;
  }
  const length = (el: Element, prop: string, along: number): number | undefined => {
    const value = get(el, prop);
    if (value === 'inherit') return el.parentElement ? length(el.parentElement, prop, along) : undefined;
    return value && value !== 'auto' && value !== 'none' ? px(resolve(el, value), along) : undefined;
  };
  /** Row and column gap, in px. */
  const gaps = (el: Element) => {
    const [row, column = row] = (get(el, 'gap') ?? '0px').split(/\s+/).map(v => px(v, 0));
    return [row, column];
  };
  /** Top, right, bottom and left padding, from `padding` or its sides. */
  const padding = (el: Element) => {
    const [t, r = t, b = t, l = r] = (get(el, 'padding') ?? '0px').split(/\s+(?![^(]*\))/).map(v => px(v, 0));
    return [t, r, b, l].map((v, i) => length(el, `padding-${['top', 'right', 'bottom', 'left'][i]}`, 0) ?? v);
  };
  /** Width and height: as set, or from a flex box's children, or estimated from text. */
  function size(el: Element): { width: number; height: number } {
    let width = length(el, 'width', screen.width),
      height = length(el, 'height', screen.height) ?? length(el, 'min-height', screen.height);
    if (width === undefined || height === undefined) {
      const display = get(el, 'display') ?? '',
        column = (get(el, 'flex-direction') ?? '').startsWith('column'),
        gap = gaps(el)[column ? 0 : 1];
      const kids = [...el.children].filter(shown).map(size),
        font = length(el, 'font-size', 0) ?? 14;
      let content: { width: number; height: number };
      if (/flex|grid/.test(display) && kids.length) {
        // Its own text is one more item, beside an icon say.
        const words = [...el.childNodes]
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent)
            .join('')
            .trim().length,
          items = words ? [...kids, { width: words * font * 0.6, height: font * 1.4 }] : kids;
        const along = items.reduce((n, k) => n + (column ? k.height : k.width), 0) + gap * (items.length - 1),
          across = Math.max(...items.map(k => (column ? k.width : k.height)));
        content = column ? { width: across, height: along } : { width: along, height: across };
      } else {
        const text = (el.textContent ?? '').trim().length;
        content = { width: text * font * 0.6 + (kids.length ? 20 : 0), height: font * 1.4 };
      }
      const [top, right, bottom, left] = padding(el);
      width ??= content.width + left + right;
      height ??= content.height + top + bottom;
    }
    return { width, height };
  }
  /** Where an absolutely placed element sits on screen, or a child within its flex row or column. */
  function box(el: Element): Box {
    const parent = el.parentElement!;
    if (get(el, 'position') !== 'absolute' && /flex/.test(get(parent, 'display') ?? '')) {
      const outer = box(parent),
        column = (get(parent, 'flex-direction') ?? '').startsWith('column'),
        reverse = (get(parent, 'flex-direction') ?? '').endsWith('reverse'),
        gap = gaps(parent)[column ? 0 : 1];
      const kids = [...parent.children].filter(shown);
      const order = reverse ? [...kids].reverse() : kids,
        sizes = order.map(size);
      // Packed to the end, the children start where their run leaves off from the far edge.
      const run = sizes.reduce((n, s) => n + (column ? s.height : s.width), 0) + gap * (order.length - 1);
      let at = /end/.test(get(parent, 'justify-content') ?? '')
        ? (column ? outer.bottom - outer.top : outer.right - outer.left) - run
        : 0;
      for (const [i, kid] of order.entries()) {
        const { width, height } = sizes[i];
        if (kid === el)
          return column
            ? { left: outer.left, top: outer.top + at, right: outer.left + width, bottom: outer.top + at + height }
            : { left: outer.left + at, top: outer.top, right: outer.left + at + width, bottom: outer.top + height };
        at += (column ? height : width) + gap;
      }
    }
    const { width, height } = size(el);
    const left = length(el, 'left', screen.width),
      right = length(el, 'right', screen.width),
      top = length(el, 'top', screen.height),
      bottom = length(el, 'bottom', screen.height);
    let x = left ?? (right !== undefined ? screen.width - right - width : 0);
    const w =
      left !== undefined && right !== undefined && length(el, 'width', 0) === undefined
        ? screen.width - left - right
        : width;
    if (/translateX\(-50%\)/.test(get(el, 'transform') ?? '')) x -= w / 2;
    const y = top ?? (bottom !== undefined ? screen.height - bottom - height : 0);
    return { left: x, top: y, right: x + w, bottom: y + height };
  }
  /** The area that takes a tap: the box, grown by an absolutely placed ::after's inset. */
  function hitBox(el: Element): Box {
    const b = box(el);
    for (const rule of all)
      for (const s of rule.selectors)
        if (s.endsWith('::after') && matches(el, s.slice(0, -7)) && rule.style.getPropertyValue('inset')) {
          const grow = -px(rule.style.getPropertyValue('inset').split(/\s+/)[0], 0);
          return { left: b.left - grow, top: b.top - grow, right: b.right + grow, bottom: b.bottom + grow };
        }
    return b;
  }
  const events = (el: Element) => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const value = get(e, 'pointer-events');
      if (value) return value;
    }
    return 'auto';
  };
  const layer = (el: Element) => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const z = get(e, 'z-index');
      if (z && get(e, 'position') === 'absolute') return +z;
    }
    return 0;
  };
  /** What a tap at (x, y) lands on among `candidates`: the topmost that takes pointer events there. */
  function hit(x: number, y: number, candidates: Element[]) {
    return (
      candidates
        .map((el, order) => ({ el, order, b: hitBox(el), z: layer(el) }))
        .filter(
          c =>
            shown(c.el) &&
            events(c.el) !== 'none' &&
            c.b.left <= x &&
            x <= c.b.right &&
            c.b.top <= y &&
            y <= c.b.bottom,
        )
        .sort((a, b) => b.z - a.z || b.order - a.order)[0]?.el ?? null
    );
  }
  return { declared, get, resolve, custom, box, hitBox, events, hit, shown };
}

export const meets = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** A CSS color as [r, g, b, alpha]: hex, rgb() or color-mix(in srgb, <color> N%, transparent). */
export function rgba(color: string): number[] {
  const mix = /color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*transparent\)/.exec(color);
  if (mix) {
    const [r, g, b, a] = rgba(mix[1]);
    return [r, g, b, (a * +mix[2]) / 100];
  }
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  const rgb = /rgba?\(([^)]+)\)/.exec(color);
  if (rgb) {
    const [r, g, b, a = '1'] = rgb[1].split(/[\s,/]+/).filter(Boolean);
    return [+r, +g, +b, +a];
  }
  throw new Error(`Cannot read the color "${color}"`);
}
/** WCAG contrast of `text` on `fill`, each laid over `backdrop` when see-through. */
export function contrastOver(text: string, fill: string, backdrop = '#000000') {
  const [br, bg, bb] = rgba(backdrop);
  const flat = (c: number[]) => [0, 1, 2].map(i => c[i] * c[3] + [br, bg, bb][i] * (1 - c[3]));
  const under = flat(rgba(fill));
  const over = rgba(text),
    ink = [0, 1, 2].map(i => over[i] * over[3] + under[i] * (1 - over[3]));
  const lum = (c: number[]) =>
    c
      .map(v => v / 255)
      .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
  const [light, dark] = [lum(ink), lum(under)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}
