import { useEffect, useRef } from 'react';

/**
 * Gives an open overlay its own history entry at the same URL, so Back (or the iOS edge swipe) closes it
 * instead of leaving the page. `onBack` returns false to stay open, such as while asking about unsaved edits.
 * ponytail: one such overlay open at a time (the label editor, the Workshop menu); nesting them needs per-entry ids.
 */
export function useBackToClose(open: boolean, onBack: () => boolean) {
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });
  useEffect(() => {
    if (!open) return;
    const push = () => history.pushState({ ...history.state, overlay: true }, '');
    const pop = () => {
      if (!latest.current()) push();
    };
    push();
    window.addEventListener('popstate', pop);
    // Closed from the page itself: drop the entry, unless a navigation already replaced it.
    return () => {
      window.removeEventListener('popstate', pop);
      if (history.state?.overlay) history.back();
    };
  }, [open]);
}

/** Opens a new page, taking over an open overlay's entry so Back doesn't return to the same page. */
export function pushPage(state: object, url: URL) {
  if (history.state?.overlay) history.replaceState(state, '', url);
  else history.pushState(state, '', url);
}
