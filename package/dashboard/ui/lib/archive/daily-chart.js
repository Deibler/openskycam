// "Hours recorded per day": one series, one hue, columns grown from a single baseline.

import { h, s } from './dom.js';
import { formatBytes, formatDuration, formatInteger, formatUtcDay } from './format.js';
import { hideTooltip, showTooltip, showTooltipFor } from './tooltip.js';
import { RETENTION_DAYS } from '../../../../shared/src/utils/layoutStorageUtil';

/** @typedef {import("./api.js").DaySummary} DaySummary */

const HEIGHT = 220;
const MARGIN = { top: 10, right: 8, bottom: 26, left: 40 };
const MAX_BAR_WIDTH = 24;
const LABEL_EVERY_DAYS = 7;

/**
 * @param {HTMLElement} container
 * @param {DaySummary[]} days oldest first
 * @param {{ selectedDay: string | null, onSelectDay: (day: string) => void }} options
 */
export function renderDailyChart(container, days, { selectedDay, onSelectDay }) {
  const width = Math.max(320, container.clientWidth);
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const maximum = Math.max(0, ...days.map(day => day.seconds / 3600));
  const ticks =
    maximum <= 1
      ? [0, 0.25, 0.5, 0.75, 1]
      : maximum <= 3
        ? [0, 1, 2, 3]
        : maximum <= 6
          ? [0, 2, 4, 6]
          : maximum <= 12
            ? [0, 3, 6, 9, 12]
            : [0, 6, 12, 18, 24];
  const maximumHours = ticks.at(-1) ?? 24;
  const band = plotWidth / Math.max(1, days.length);
  const barWidth = Math.min(MAX_BAR_WIDTH, band * 0.62);
  /** @param {number} hours */
  const y = hours => MARGIN.top + plotHeight - (Math.min(hours, maximumHours) / maximumHours) * plotHeight;

  const svg = s('svg', {
    viewBox: `0 0 ${width} ${HEIGHT}`,
    role: 'group',
    'aria-label': `Hours recorded per day, last ${RETENTION_DAYS} days`,
  });

  for (const hours of ticks) {
    const lineY = Math.round(y(hours)) + 0.5;
    svg.append(
      s('line', {
        class: hours === 0 ? 'baseline' : 'gridline',
        x1: MARGIN.left,
        x2: width - MARGIN.right,
        y1: lineY,
        y2: lineY,
      }),
      s(
        'text',
        { x: MARGIN.left - 8, y: lineY + 4, 'text-anchor': 'end' },
        maximumHours === 1 ? `${hours * 60} m` : `${hours} h`,
      ),
    );
  }

  days.forEach((day, index) => {
    const left = MARGIN.left + band * index;
    const hours = day.seconds / 3600;
    svg.append(hitArea(day, left, band, plotHeight, onSelectDay));
    if (hours > 0) {
      const top = y(hours);
      const selected = day.day === selectedDay ? ' is-selected' : '';
      svg.append(
        s('path', { class: `bar${selected}`, d: columnPath(left + (band - barWidth) / 2, top, barWidth, y(0) - top) }),
      );
    }
    if ((days.length - 1 - index) % LABEL_EVERY_DAYS === 0) {
      svg.append(s('text', { x: left + band / 2, y: HEIGHT - 8, 'text-anchor': 'middle' }, formatUtcDay(day.day)));
    }
  });

  container.replaceChildren(svg);
}

/**
 * The same data as a table, so no value is reachable only by hovering.
 * @param {HTMLElement} container
 * @param {DaySummary[]} days
 */
export function renderDailyTable(container, days) {
  const rows = [...days]
    .reverse()
    .map(day =>
      h(
        'tr',
        {},
        h('td', {}, formatUtcDay(day.day)),
        h('td', { class: 'num' }, formatDuration(day.seconds)),
        h('td', { class: 'num' }, formatInteger(day.segments)),
        h('td', { class: 'num' }, formatBytes(day.bytes)),
      ),
    );
  container.replaceChildren(
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', {}, 'Day (UTC)'),
          h('th', { class: 'num' }, 'Recorded'),
          h('th', { class: 'num' }, 'Segments'),
          h('th', { class: 'num' }, 'Stored'),
        ),
      ),
      h('tbody', {}, ...rows),
    ),
  );
}

/** The whole column band is the hover/focus target, not just the painted bar. */
function hitArea(
  /** @type {DaySummary} */ day,
  /** @type {number} */ left,
  /** @type {number} */ band,
  /** @type {number} */ plotHeight,
  /** @type {(day: string) => void} */ onSelectDay,
) {
  const content = {
    value: formatDuration(day.seconds),
    label: `${formatUtcDay(day.day)} (UTC)`,
    detail: `${formatInteger(day.segments)} segments · ${formatBytes(day.bytes)}`,
  };
  const area = s('rect', {
    class: 'bar-hit',
    x: left,
    y: MARGIN.top,
    width: band,
    height: plotHeight,
    tabindex: day.segments > 0 ? 0 : -1,
    role: 'button',
    'aria-disabled': day.segments === 0 ? 'true' : undefined,
    'aria-label': `${formatUtcDay(day.day)}: ${content.value} recorded, ${content.detail}.${day.segments > 0 ? ' Open this day.' : ' No footage.'}`,
  });
  area.addEventListener('pointermove', event => showTooltip(content, event.clientX, event.clientY));
  area.addEventListener('pointerleave', hideTooltip);
  area.addEventListener('focus', () => showTooltipFor(content, area));
  area.addEventListener('blur', hideTooltip);
  area.addEventListener('click', () => {
    if (day.segments > 0) onSelectDay(day.day);
  });
  area.addEventListener('keydown', event => {
    if (day.segments > 0 && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onSelectDay(day.day);
    }
  });
  return area;
}

/**
 * A column with a 4px rounded data-end and a square base.
 * @param {number} x @param {number} y @param {number} width @param {number} height
 */
function columnPath(x, y, width, height) {
  const r = Math.min(4, height, width / 2);
  return `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`;
}
