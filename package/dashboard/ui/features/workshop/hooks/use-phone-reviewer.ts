import { useMediaQuery } from '../../../hooks/use-compact-layout';

// Keep aligned with the phone block in styles/reviewer.css.
export const PHONE_REVIEWER = '(max-width: 640px), (max-height: 500px) and (pointer: coarse)';

/** Whether the reviewer is laid out for a phone: full screen, with the caption and actions over the photo. */
export const usePhoneReviewer = () => useMediaQuery(PHONE_REVIEWER);
