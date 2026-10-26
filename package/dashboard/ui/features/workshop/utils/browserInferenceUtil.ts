import type { CSSProperties } from 'react';
import type { WorkshopRunImage } from '../../../../src/models/workshopInferencemodel';
import { thumbnailCrop } from '../../../../src/utils/thumbnailInferenceUtil';
import type { BrowserFilters } from '../models/browserInferencemodel';
import type { Sighting } from '../models/sightingInferencemodel';
import { imageGeometry } from './reviewGeometryInferenceUtil';
import { topBox } from './sightingInferenceUtil';

export const emptyFilters: BrowserFilters = {
  q: '',
  run: '',
  camera: '',
  class: '',
  review: '',
  from: '',
  to: '',
  min_confidence: '',
  max_confidence: '',
  min_objects: '',
  max_objects: '',
  saved: '',
  sort: 'newest',
};
export function browserQuery(filters: BrowserFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value !== '') {
      if (key === 'from' || key === 'to') {
        if (Number.isFinite(Date.parse(value))) params.set(key, new Date(value).toISOString());
      } else params.set(key, value);
    }
  return params.toString();
}
const nextDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};
/** The capture-time filters covering one local day (YYYY-MM-DD), or none for ''. */
export const dayFilter = (day: string) =>
  day ? { from: `${day}T00:00`, to: `${nextDay(day)}T00:00` } : { from: '', to: '' };
/** The local day the capture-time filters span exactly, or '' for any other range. */
export function filterDay(filters: BrowserFilters) {
  const day = filters.from.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && filters.from === `${day}T00:00` && filters.to === `${nextDay(day)}T00:00`
    ? day
    : '';
}
/** Sightings under a heading for each local day, in order, each with its place in the whole list. */
export function sightingDays(sightings: Sighting[]) {
  const days: { label: string; items: { sighting: Sighting; index: number }[] }[] = [],
    year = new Date().getFullYear();
  sightings.forEach((sighting, index) => {
    const at = new Date(sighting.frames[0].captured_at);
    const label = at.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      ...(at.getFullYear() !== year ? { year: 'numeric' as const } : {}),
    });
    if (days.at(-1)?.label !== label) days.push({ label, items: [] });
    days.at(-1)!.items.push({ sighting, index });
  });
  return days;
}
/**
 * How a tile frames a photo. A full frame slides to keep its object in view. An object thumbnail
 * comes cut to its object; a full photo standing in for one is scaled so the same part of the frame
 * fills the tile's height, centered on the tile, as the thumbnail would be.
 */
export function tileFraming(item: WorkshopRunImage, crop: boolean, original: boolean): CSSProperties | undefined {
  const box = topBox(item);
  if (!box) return undefined;
  if (!crop) return { objectPosition: `${Math.round((box[0] + box[2]) * 50)}% 50%` };
  if (!original) return undefined;
  const { width, height } = imageGeometry(item),
    view = thumbnailCrop(width, height, box);
  const x = ((view.left + view.width / 2) / width) * 100,
    y = ((view.top + view.height / 2) / height) * 100;
  return {
    top: '50%',
    right: 'auto',
    bottom: 'auto',
    left: '50%',
    width: 'auto',
    maxWidth: 'none',
    height: `${(height / view.height) * 100}%`,
    transform: `translate(${-x}%, ${-y}%)`,
  };
}
export function thumbnailUrl(item: WorkshopRunImage, crop: boolean, large: boolean) {
  // Edited bounds must invalidate the cropped thumbnail without changing the original photo URL.
  let version = 0;
  for (const ch of item.annotation_json) version = (Math.imul(version, 31) + ch.charCodeAt(0)) | 0;
  return `/api/workshop/items/${encodeURIComponent(item.id)}/thumbnail?format=1&mode=${crop ? 'object' : 'frame'}&size=${large ? 512 : 256}&v=${version}`;
}
