import { useCallback, useSyncExternalStore } from 'react';

// A rotated phone can be wider than the desktop breakpoint. Keep its touch layout.
// Keep these queries aligned with the mobile media rules in styles.css.
export const COMPACT_QUERY = '(max-width: 800px), (max-height: 600px) and (pointer: coarse)';
export const LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 600px) and (pointer: coarse)';
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    useCallback(
      (change: () => void) => {
        if (!window.matchMedia) return () => {};
        const media = window.matchMedia(query);
        media.addEventListener('change', change);
        return () => media.removeEventListener('change', change);
      },
      [query],
    ),
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}
export function useCompactLayout() {
  return useMediaQuery(COMPACT_QUERY);
}
export function useLandscapeLayout() {
  return useMediaQuery(LANDSCAPE_QUERY);
}
