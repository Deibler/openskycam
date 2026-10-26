import { useState } from 'react';
import type { WorkshopWorkflowStats } from '../../../../src/models/workshopInferencemodel';

const DAYS = 14;
const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
/** The last two weeks of UTC days, with days that found nothing as zero. */
export function lastDays(daily: WorkshopWorkflowStats['daily'], now = new Date()) {
  const counts = new Map(daily.map(d => [d.day, d.images]));
  return Array.from({ length: DAYS }, (_, i) => {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (DAYS - 1 - i)))
      .toISOString()
      .slice(0, 10);
    return { day, images: counts.get(day) ?? 0 };
  });
}

/** Sightings per UTC day. One series, so the title names it and no legend is needed. */
export function DailyChart({ daily, compact = false }: { daily: WorkshopWorkflowStats['daily']; compact?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const days = lastDays(daily),
    max = Math.max(1, ...days.map(d => d.images));
  const peak = days.reduce((best, d, i) => (d.images > days[best].images ? i : best), 0);
  const total = days.reduce((sum, d) => sum + d.images, 0);
  const shown = hover ?? (compact ? null : peak);
  return (
    <figure className="wk-daily" data-compact={compact || undefined}>
      {!compact && (
        <figcaption>
          Sightings per day <span>last {DAYS} days, UTC</span>
        </figcaption>
      )}
      <div
        className="wk-daily-plot"
        role="img"
        aria-label={
          total
            ? `${total.toLocaleString()} sightings in the last ${DAYS} days, most on ${dayLabel(days[peak].day)} with ${days[peak].images.toLocaleString()}`
            : `No sightings in the last ${DAYS} days`
        }
        onMouseLeave={() => setHover(null)}
      >
        {days.map((d, i) => (
          <span key={d.day} className="wk-daily-column" onMouseEnter={() => setHover(i)}>
            <i style={{ height: d.images ? `max(2px, ${(d.images / max) * 100}%)` : 0 }} />
          </span>
        ))}
        {shown !== null && days[shown].images > 0 && (
          <output
            className="wk-daily-tip"
            data-edge={shown < 2 ? 'start' : shown > DAYS - 3 ? 'end' : undefined}
            style={{ left: `${((shown + 0.5) / DAYS) * 100}%` }}
          >
            <strong>{days[shown].images.toLocaleString()}</strong> {dayLabel(days[shown].day)}
          </output>
        )}
      </div>
      {!compact && (
        <div className="wk-daily-axis" aria-hidden="true">
          <span>{dayLabel(days[0].day)}</span>
          <span>{dayLabel(days[DAYS - 1].day)}</span>
        </div>
      )}
      {!compact && (
        <table className="sr-only">
          <caption>Sightings per day</caption>
          <tbody>
            {days.map(d => (
              <tr key={d.day}>
                <th>{dayLabel(d.day)}</th>
                <td>{d.images}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}

/** Per class: how often the model saw it, and how often a reviewer agreed. */
export function ClassTable({ classes }: { classes: WorkshopWorkflowStats['classes'] }) {
  if (!classes.length) return <p className="wk-hint">No detections yet.</p>;
  return (
    <table className="wk-class-table">
      <thead>
        <tr>
          <th>Class</th>
          <th>Sightings</th>
          <th>Accepted</th>
          <th>Denied</th>
          <th>Confirmed</th>
        </tr>
      </thead>
      <tbody>
        {classes.map(c => {
          const reviewed = c.accepted + c.rejected,
            rate = reviewed ? c.accepted / reviewed : null;
          return (
            <tr key={c.class_name}>
              <th scope="row">{c.class_name}</th>
              <td>{c.images.toLocaleString()}</td>
              <td>{c.accepted.toLocaleString()}</td>
              <td>{c.rejected.toLocaleString()}</td>
              <td>
                {rate === null ? (
                  <span className="wk-hint">Not reviewed</span>
                ) : (
                  <span className="wk-meter">
                    <meter min={0} max={1} value={rate} aria-label={`${c.class_name} confirmed`} />
                    {Math.round(rate * 100)}%
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
