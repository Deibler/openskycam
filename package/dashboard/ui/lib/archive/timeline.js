import { s } from './dom.js';
import { addDays, clockTime, nearestRecording } from './recordings.js';
import { hideTooltip, showTooltip } from './tooltip.js';

/** @typedef {import('./api.js').Segment} Segment */
/** @typedef {import('./recordings.js').Zone} Zone */

/** @param {HTMLElement} container @param {{ day: Date, zone: Zone, segments: Segment[], selected: Segment | null, zoom: boolean, onSeek: (time: Date) => void }} options */
export function renderTimeline(container, { day, zone, segments, selected, zoom, onSeek }) {
  const width = Math.max(280, container.clientWidth);
  let from = day.getTime();
  let to = addDays(day, 1, zone).getTime();
  if (zoom) {
    const date = new Date(selected?.start ?? day);
    if (zone === 'UTC') date.setUTCMinutes(0, 0, 0);
    else date.setMinutes(0, 0, 0);
    from = date.getTime();
    to = from + 3600000;
  }
  const duration = to - from;
  const padding = 1;
  const plotWidth = width - padding * 2;
  /** @param {number} time */
  const x = time => padding + Math.max(0, Math.min(1, (time - from) / duration)) * plotWidth;
  const selectedTime = selected ? Date.parse(selected.start) : from;
  const svg = s('svg', {
    viewBox: `0 0 ${width} 46`,
    preserveAspectRatio: 'none',
    role: 'slider',
    tabindex: 0,
    'aria-label': zoom ? 'Recording timeline, selected hour' : 'Recording timeline, selected day',
    'aria-valuemin': 0,
    'aria-valuemax': Math.round(duration / 60000),
    'aria-valuenow': Math.max(0, Math.round((selectedTime - from) / 60000)),
    'aria-valuetext': selected ? clockTime(new Date(selected.start), zone, true) : 'No recording selected',
  });
  svg.append(s('rect', { class: 'timeline-track', x: padding, y: 18, width: plotWidth, height: 20, rx: 3 }));
  const ticks = width < 430 ? 4 : 6;
  for (let i = 0; i <= ticks; i++) {
    const time = from + (duration * i) / ticks;
    svg.append(
      s(
        'text',
        { x: x(time), y: 10, 'text-anchor': i === 0 ? 'start' : i === ticks ? 'end' : 'middle' },
        clockTime(new Date(time), zone),
      ),
      s('line', { class: 'timeline-mark', x1: x(time), x2: x(time), y1: 15, y2: 41 }),
    );
  }
  for (const segment of segments) {
    const start = Date.parse(segment.start);
    const end = start + (segment.duration_s ?? 60) * 1000;
    if (end <= from || start >= to) continue;
    svg.append(
      s('rect', {
        class: 'timeline-segment',
        x: x(start),
        y: 20,
        width: Math.max(1, x(end) - x(start)),
        height: 16,
        rx: 0.7,
      }),
    );
  }
  if (selected && selectedTime >= from && selectedTime < to) {
    const selectedX = x(selectedTime);
    svg.append(
      s('line', { class: 'timeline-marker', x1: selectedX, x2: selectedX, y1: 15, y2: 43 }),
      s('path', { class: 'timeline-marker-head', d: `M${selectedX - 4} 12h8l-4 5z` }),
    );
  }
  /** @param {PointerEvent | MouseEvent} event */
  const timeAt = event => {
    const box = svg.getBoundingClientRect();
    return new Date(from + Math.max(0, Math.min(0.999999, (event.clientX - box.left) / box.width)) * duration);
  };
  svg.addEventListener('pointermove', event => {
    const time = timeAt(event);
    const found = nearestRecording(segments, time);
    showTooltip(
      {
        value: clockTime(time, zone, true),
        label: found?.exact
          ? 'Recorded · click to play'
          : found
            ? `No footage here · nearest ${clockTime(new Date(found.segment.start), zone)}`
            : 'No recordings on this day',
      },
      event.clientX,
      event.clientY,
    );
  });
  svg.addEventListener('pointerleave', hideTooltip);
  svg.addEventListener('blur', hideTooltip);
  svg.addEventListener('click', event => {
    hideTooltip();
    onSeek(timeAt(event));
  });
  svg.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = segments.findIndex(s => s.start === selected?.start);
    const target =
      event.key === 'Home'
        ? segments[0]
        : event.key === 'End'
          ? segments.at(-1)
          : segments[Math.max(0, Math.min(segments.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))];
    if (target) onSeek(new Date(target.start));
  });
  const focused = container.contains(document.activeElement);
  container.replaceChildren(svg);
  if (focused) svg.focus();
}
