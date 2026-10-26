import type { BrowserPreferences } from '../models/browserInferencemodel';

export function readBrowserPreferences(bucket: string): Partial<BrowserPreferences> {
  try {
    const value = JSON.parse(localStorage.getItem(`workshop.browser.${bucket}`) ?? '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}
export function writeBrowserPreferences(bucket: string, value: BrowserPreferences) {
  try {
    localStorage.setItem(`workshop.browser.${bucket}`, JSON.stringify(value));
  } catch {
    /* Browsing also works when storage is disabled. */
  }
}
