import { useLayoutEffect, useRef, useState } from 'react';
import { renderDailyChart, renderDailyTable } from '../lib/archive/daily-chart.js';
import { renderMinuteGrid } from '../lib/archive/minute-grid.js';
import { renderKpis } from '../lib/archive/kpis.js';
import { dateLabel } from '../lib/archive/recordings.js';
import { hideTooltip } from '../lib/archive/tooltip.js';
import type { Overview, Segment, Zone } from '../lib/types';
import { Button } from './ui/button';
import { RETENTION_DAYS } from '../../../shared/src/utils/layoutStorageUtil';

type DayProps = { day: Date; zone: Zone; segments: Segment[]; selected: Segment | null };
export function Activity({
  overview,
  day,
  zone,
  segments,
  selected,
  onDay,
  onClip,
}: DayProps & { overview: Overview | null; onDay: (key: string) => void; onClip: (s: Segment) => void }) {
  const chart = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLDivElement>(null);
  const minute = useRef<HTMLDivElement>(null);
  const stats = useRef<HTMLDivElement>(null);
  const [showTable, setShowTable] = useState(false);
  useLayoutEffect(() => {
    if (!overview) return;
    renderKpis(stats.current!, overview);
    renderDailyTable(table.current!, overview.days);
    const draw = () => {
      if (chart.current!.clientWidth)
        renderDailyChart(chart.current!, overview.days, { selectedDay: null, onSelectDay: onDay });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(chart.current!);
    return () => {
      observer.disconnect();
      hideTooltip();
    };
  }, [overview, onDay]);
  useLayoutEffect(() => {
    renderMinuteGrid(minute.current!, { dayStart: day, segments, selected, now: new Date(), zone, onSelect: onClip });
  }, [day.getTime(), zone, segments, selected?.start, onClip]);
  return (
    <section className="activity-view">
      <header className="activity-heading">
        <div>
          <h1>Activity</h1>
          <p>Recording coverage and storage over the last {RETENTION_DAYS} days.</p>
        </div>
        <span>{RETENTION_DAYS}-day retention</span>
      </header>
      <div className="kpis" ref={stats} />
      <section className="activity-section">
        <div className="section-heading">
          <div>
            <h2>Recording history</h2>
            <p>Hours recorded each day · UTC</p>
          </div>
          <Button variant="ghost" aria-expanded={showTable} onClick={() => setShowTable(!showTable)}>
            {showTable ? 'Hide data' : 'Show data'}
          </Button>
        </div>
        <div className="chart" ref={chart} />
        <div className="data-table" ref={table} hidden={!showTable} />
      </section>
      <section className="activity-section">
        <h2>Minute coverage</h2>
        <p>
          {dateLabel(day, zone)} · {zone === 'UTC' ? 'UTC' : 'Local time'} · Select a recorded minute to play.
        </p>
        <div className="minute-grid" ref={minute} />
        <div className="legend">
          <span>
            <i className="recorded" />
            Recorded
          </span>
          <span>
            <i className="missing" />
            No footage
          </span>
        </div>
      </section>
    </section>
  );
}
