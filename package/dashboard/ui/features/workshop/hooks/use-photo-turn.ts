import { type RefObject, useEffect, useRef, useState } from 'react';

// A full photo stands in for a thumbnail the server could not make. Each is ~0.7 MB, and a phone
// that asks for a screenful at once shows none of them for seconds, so a few load at a time, in the
// order their tiles came on screen.
const atOnce = 3;
let loading = 0;
const waiting: (() => void)[] = [];

function startNext() {
  while (loading < atOnce && waiting.length) {
    loading++;
    waiting.shift()!();
  }
}

/**
 * Whether the element in `ref` may load its full photo yet: once it is `wanted` and on screen, its
 * turn comes when one of a few is free. A tile that leaves the screen first gives up its place.
 * Call `done` when the photo loads or fails, to pass the turn on.
 */
export function usePhotoTurn(ref: RefObject<Element | null>, wanted: boolean) {
  const [turn, setTurn] = useState(false),
    holding = useRef(false);
  const done = useRef(() => {
    if (!holding.current) return;
    holding.current = false;
    loading--;
    startNext();
  }).current;
  useEffect(() => {
    const element = ref.current;
    if (!wanted || turn || !element) return;
    const start = () => {
      holding.current = true;
      setTurn(true);
    };
    const join = () => {
      if (!waiting.includes(start)) waiting.push(start);
      startNext();
    };
    const leave = () => {
      const at = waiting.indexOf(start);
      if (at >= 0) waiting.splice(at, 1);
    };
    if (typeof IntersectionObserver === 'undefined') {
      join();
      return leave;
    }
    const observer = new IntersectionObserver(([entry]) => (entry.isIntersecting ? join() : leave()));
    observer.observe(element);
    return () => {
      observer.disconnect();
      leave();
    };
  }, [wanted, turn]);
  // A tile that goes away mid-load passes its turn on.
  useEffect(() => done, []);
  return [turn, done] as const;
}
