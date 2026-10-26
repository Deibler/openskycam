import { useEffect, useRef } from 'react';

/**
 * A scroll-snap strip and an index that follow each other: a swipe reports the page it settles on,
 * and a changed index scrolls there, smoothly to a neighbour and instantly further away or on opening.
 * A changed `layout` (pages added in front) scrolls back to the index: the browser keeps the page it
 * showed snapped, which would otherwise report as a swipe. A resized strip (Safari's toolbar, a
 * rotation) shows its page whole again at once, never part of two.
 */
export function useSnapScroll(axis: 'x' | 'y', index: number, onIndex: (index: number) => void, layout = 0) {
  const ref = useRef<HTMLDivElement>(null),
    target = useRef<number | null>(null),
    opened = useRef(false),
    latest = useRef(index);
  latest.current = index;
  const place = (element: HTMLElement) => {
    const size = axis === 'x' ? element.clientWidth : element.clientHeight;
    return size ? (axis === 'x' ? element.scrollLeft : element.scrollTop) / size : null;
  };
  useEffect(() => {
    const element = ref.current,
      at = element && place(element),
      first = !opened.current;
    if (at != null) opened.current = true;
    if (!element || at == null || Math.round(at) === index) return;
    // Scroll events during the move report pages on the way; ignore them until it arrives.
    target.current = index;
    const timer = setTimeout(() => {
      target.current = null;
    }, 1000);
    const size = axis === 'x' ? element.clientWidth : element.clientHeight;
    element.scrollTo?.({
      [axis === 'x' ? 'left' : 'top']: index * size,
      ...(first || Math.abs(at - index) > 1.5 ? { behavior: 'instant' } : {}),
    });
    return () => {
      clearTimeout(timer);
      target.current = null;
    };
  }, [index, layout]);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const length = () => (axis === 'x' ? element.clientWidth : element.clientHeight);
    let size = length();
    const observer = new ResizeObserver(() => {
      const next = length();
      if (!next || next === size) return;
      size = next;
      element.scrollTo?.({ [axis === 'x' ? 'left' : 'top']: latest.current * next, behavior: 'instant' });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  function onScroll() {
    const at = ref.current && place(ref.current);
    if (at == null) return;
    const next = Math.round(at);
    if (target.current !== null) {
      if (next !== target.current) return;
      target.current = null;
    }
    if (next !== index) onIndex(next);
  }
  return [ref, onScroll] as const;
}
