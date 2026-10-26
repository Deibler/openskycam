import { h } from './dom.js';
import { formatBytes, formatDuration, formatInteger } from './format.js';
import { RETENTION_DAYS } from '../../../../shared/src/utils/layoutStorageUtil';

/** @param {HTMLElement} container @param {import('./api.js').Overview} overview */
export function renderKpis(container, { last_24h: recent, retained, projection }) {
  container.replaceChildren(
    tile(
      'Recorded in the last 24 hours',
      formatDuration(recent.seconds),
      `${formatInteger(recent.segments)} recordings uploaded`,
    ),
    tile(
      'Archive size',
      formatBytes(retained.bytes),
      `${formatDuration(retained.seconds)} across ${formatInteger(retained.segments)} recordings`,
    ),
    tile(
      'Footage when full',
      projection.steady_state_bytes === null ? '—' : formatBytes(projection.steady_state_bytes),
      projection.steady_state_bytes === null
        ? 'Waiting for enough recordings'
        : `At 24/7 recording · ${RETENTION_DAYS} days kept`,
    ),
    tile(
      'Daily storage at this bitrate',
      projection.bytes_per_day === null ? '—' : formatBytes(projection.bytes_per_day),
      'Estimate based on recent uploads',
    ),
  );
}
/** @param {string} label @param {string} value @param {string} detail */
function tile(label, value, detail) {
  return h(
    'div',
    { class: 'tile' },
    h('div', { class: 'tile__label' }, label),
    h('div', { class: 'tile__value' }, value),
    h('div', { class: 'tile__detail' }, detail),
  );
}
