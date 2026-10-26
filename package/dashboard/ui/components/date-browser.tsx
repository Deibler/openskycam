import { useEffect, useState } from 'react';
import { useLandscapeLayout } from '../hooks/use-compact-layout';
import { Calendar } from './ui/calendar';
import { Button } from './ui/button';
import { RETENTION_DAYS } from '../../../shared/src/utils/layoutStorageUtil';
import { addDays, dayKey } from '../lib/archive/recordings.js';
import type { Zone } from '../lib/types';
import type { DayAvailability } from '../hooks/use-available-days';
export function DateBrowser({
  value,
  zone,
  availability,
  onChange,
  onZone,
}: {
  value: string;
  zone: Zone;
  availability: DayAvailability;
  onChange: (value: string) => void;
  onZone?: (zone: Zone) => void;
}) {
  const landscape = useLandscapeLayout();
  const selected = new Date(`${value}T12:00:00`);
  const [month, setMonth] = useState(selected);
  useEffect(() => setMonth(new Date(`${value}T12:00:00`)), [value]);
  const earliest = new Date(`${dayKey(addDays(new Date(), -RETENTION_DAYS, zone), zone)}T00:00:00`);
  const latest = new Date(`${dayKey(new Date(), zone)}T23:59:59`);
  const available = (date: Date) => Boolean(availability.days?.has(dayKey(date, 'local')));
  const today = dayKey(new Date(), zone);
  if (landscape)
    return (
      <div className="landscape-date-browser">
        <div className="date-browser-context">
          <p>Days with footage</p>
          <span>Last {RETENTION_DAYS} days</span>
          <Button variant="secondary" disabled={!availability.days?.has(today)} onClick={() => onChange(today)}>
            Today
          </Button>
          {onZone && (
            <label>
              Time zone
              <select value={zone} onChange={event => onZone(event.target.value as Zone)}>
                <option value="local">Local time</option>
                <option value="UTC">UTC</option>
              </select>
            </label>
          )}
        </div>
        <div className="recorded-day-list" role="group" aria-label="Recorded days">
          {[...(availability.days ?? [])]
            .sort()
            .reverse()
            .map(date => (
              <Button variant="ghost" key={date} aria-pressed={date === value} onClick={() => onChange(date)}>
                <strong>
                  {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
                    new Date(`${date}T12:00:00`),
                  )}
                </strong>
                <span>
                  {new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date(`${date}T12:00:00`))}
                </span>
              </Button>
            ))}
          {availability.error ? (
            <div role="status">
              {availability.error}
              <Button variant="ghost" onClick={availability.retry}>
                Retry
              </Button>
            </div>
          ) : availability.loading ? (
            <p role="status">Checking recordings…</p>
          ) : (
            !availability.days?.size && <p role="status">No recordings in the last {RETENTION_DAYS} days.</p>
          )}
        </div>
      </div>
    );
  return (
    <>
      <Calendar
        today={new Date(`${today}T12:00:00`)}
        mode="single"
        selected={availability.days?.has(value) ? selected : undefined}
        month={month}
        onMonthChange={setMonth}
        onSelect={date => {
          if (date && available(date)) onChange(dayKey(date, 'local'));
        }}
        disabled={date => date < earliest || date > latest || !available(date)}
        startMonth={earliest}
        endMonth={latest}
        className="archive-calendar"
      />
      <div className="calendar-availability" role="status">
        {availability.error ? (
          <>
            {availability.error}
            <Button variant="ghost" onClick={availability.retry}>
              Retry
            </Button>
          </>
        ) : availability.loading ? (
          'Checking recordings…'
        ) : availability.days?.size ? (
          'Only dates with recordings are available.'
        ) : (
          `No recordings in the last ${RETENTION_DAYS} days.`
        )}
      </div>
      <div className="calendar-options">
        <Button variant="ghost" disabled={!availability.days?.has(today)} onClick={() => onChange(today)}>
          Today
        </Button>
        {onZone && (
          <label>
            Time zone
            <select value={zone} onChange={event => onZone(event.target.value as Zone)}>
              <option value="local">Local time</option>
              <option value="UTC">UTC</option>
            </select>
          </label>
        )}
      </div>
    </>
  );
}
