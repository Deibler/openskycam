import { s } from './dom.js';
import { formatBytes, formatDuration } from './format.js';
import { addDays, clockTime, dateLabel } from './recordings.js';
import { hideTooltip, showTooltip, showTooltipFor } from './tooltip.js';

/** @typedef {import('./api.js').Segment} Segment */
const CELL = 10,
  PITCH = 12,
  LEFT = 58,
  TOP = 22,
  COLUMNS = 60;

/** @param {HTMLElement} container @param {{ dayStart: Date, segments: Segment[], selected: Segment | null, now: Date, zone: import('./recordings.js').Zone, onSelect: (segment: Segment) => void }} options */
export function renderMinuteGrid(container, { dayStart, segments, selected, now, zone, onSelect }) {
  const start = dayStart.getTime();
  const end = addDays(dayStart, 1, zone).getTime();
  const minutes = Math.round((end - start) / 60000);
  const rows = Math.ceil(minutes / COLUMNS);
  /** @type {Map<number, Segment>} */ const cells = new Map();
  for (const segment of segments) {
    const first = Math.max(0, Math.floor((Date.parse(segment.start) - start) / 60000));
    const last = Math.min(
      minutes,
      Math.ceil((Date.parse(segment.start) + (segment.duration_s ?? 60) * 1000 - start) / 60000),
    );
    for (let i = first; i < last; i++) if (!cells.has(i)) cells.set(i, segment);
  }
  const svg = s('svg', {
    viewBox: `0 0 ${LEFT + COLUMNS * PITCH + 4} ${TOP + rows * PITCH + 4}`,
    role: 'group',
    'aria-label': `Minute coverage on ${dateLabel(dayStart, zone)}. Arrow keys move between recorded minutes. Enter plays a recording.`,
  });
  for (const minute of [0, 15, 30, 45])
    svg.append(s('text', { x: LEFT + minute * PITCH, y: 10 }, `:${String(minute).padStart(2, '0')}`));
  /** @type {SVGElement[]} */ const targets = [];
  for (let row = 0; row < rows; row++) {
    const y = TOP + row * PITCH;
    if (row % 3 === 0 || rows !== 24)
      svg.append(
        s(
          'text',
          { x: LEFT - 10, y: y + CELL - 1, 'text-anchor': 'end' },
          clockTime(new Date(start + row * 3600000), zone),
        ),
      );
    for (let minute = 0; minute < COLUMNS; minute++) {
      const index = row * COLUMNS + minute;
      if (index >= minutes) continue;
      const time = new Date(start + index * 60000);
      const segment = cells.get(index);
      const state = segment ? 'recorded' : time > now ? 'future' : 'missing';
      const rect = s('rect', {
        class: `cell cell--${state}${segment?.start === selected?.start && segment ? ' cell--selected' : ''}`,
        x: LEFT + minute * PITCH,
        y,
        width: CELL,
        height: CELL,
        rx: 1.5,
        'data-cell': index,
        ...(segment
          ? {
              tabindex: targets.length === 0 ? 0 : -1,
              role: 'button',
              'aria-label': `Play ${clockTime(time, zone)}${rows > 24 ? ' · ' + time.toISOString() : ''}`,
            }
          : {}),
      });
      if (segment) {
        const content = {
          value: clockTime(time, zone),
          label: `${formatDuration(segment.duration_s ?? 0)} · ${formatBytes(segment.size)}`,
          detail: 'Select to play',
        };
        rect.addEventListener('focus', () => showTooltipFor(content, rect));
        rect.addEventListener('blur', hideTooltip);
        rect.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            hideTooltip();
            onSelect(segment);
          }
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const at = targets.indexOf(rect);
            const delta =
              event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowUp' ? -60 : event.key === 'ArrowDown' ? 60 : 1;
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? targets.length - 1
                  : Math.max(0, Math.min(targets.length - 1, at + delta));
            rect.setAttribute('tabindex', '-1');
            targets[next].setAttribute('tabindex', '0');
            targets[next].focus();
          }
        });
        targets.push(rect);
      }
      svg.append(rect);
    }
  }
  /** @param {Event} event */
  const cellAt = event => {
    const target = /** @type {Element | null} */ (event.target);
    const index = target?.getAttribute('data-cell');
    return index === null || index === undefined ? null : Number(index);
  };
  svg.addEventListener('pointermove', event => {
    const index = cellAt(event);
    if (index === null) {
      hideTooltip();
      return;
    }
    const time = new Date(start + index * 60000);
    const segment = cells.get(index);
    showTooltip(
      {
        value: clockTime(time, zone),
        label: segment
          ? `${formatDuration(segment.duration_s ?? 0)} · ${formatBytes(segment.size)}`
          : time > now
            ? 'Not yet recorded'
            : 'No recording',
        ...(segment ? { detail: 'Select to play' } : {}),
      },
      event.clientX,
      event.clientY,
    );
  });
  svg.addEventListener('pointerleave', hideTooltip);
  svg.addEventListener('click', event => {
    const index = cellAt(event);
    const segment = index === null ? undefined : cells.get(index);
    if (segment) {
      hideTooltip();
      onSelect(segment);
    }
  });
  container.replaceChildren(svg);
}
