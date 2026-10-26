import { LoadingStatus } from './brand-indicator';
import { lazy, Suspense, useRef, useState, type ReactNode, type RefObject } from 'react';
import { CalendarDays, ChevronDown, ChevronUp, Grid2X2 } from 'lucide-react';
import type { Zone } from '../lib/types';
import type { DayAvailability } from '../hooks/use-available-days';
import { dateLabel } from '../lib/archive/recordings.js';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

const DateBrowser = lazy(() => import('./date-browser').then(module => ({ default: module.DateBrowser })));

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: Date;
  dayKey: string;
  zone: Zone;
  count: number;
  availability: DayAvailability;
  onDate: (day: string) => void;
  onZone: (zone: Zone) => void;
  fullscreen?: boolean;
  returnFocus?: RefObject<HTMLElement | null>;
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
};

export function MobileRecordingSheet(p: Props) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      {!p.fullscreen && (
        <DialogTrigger asChild>
          <Button variant="secondary" className="browse-recordings-button" aria-label="Browse recordings">
            <Grid2X2 />
            <span>Browse recordings</span>
            <small>{p.count} clips</small>
            <ChevronUp />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        placement="bottom"
        className={`mobile-browser-sheet${p.fullscreen ? ' fullscreen-browser-sheet' : ''}`}
        onOpenAutoFocus={event => {
          event.preventDefault();
          (p.initialFocus?.current ?? title.current)?.focus();
        }}
        onCloseAutoFocus={event => {
          if (p.fullscreen) {
            event.preventDefault();
            p.returnFocus?.current?.focus({ preventScroll: true });
          }
        }}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <DialogTitle ref={title} tabIndex={-1}>
          Browse recordings
        </DialogTitle>
        <DialogDescription className="sr-only">
          Choose a date and hour, then tap a minute to watch. Use Go to time for an exact moment, Time range to review
          across hours, or Filter for saved recordings.
        </DialogDescription>
        <div className="sheet-date-row">
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" className="sheet-date-button">
                <CalendarDays />
                {dateLabel(p.day, p.zone)}
                {p.zone === 'UTC' && <small>UTC</small>}
                <ChevronDown />
              </Button>
            </PopoverTrigger>
            <PopoverContent aria-label="Recording date" className="calendar-popover" align="start">
              <Suspense fallback={<LoadingStatus className="calendar-loading">Loading calendar…</LoadingStatus>}>
                <DateBrowser
                  value={p.dayKey}
                  zone={p.zone}
                  availability={p.availability}
                  onChange={day => {
                    p.onDate(day);
                    setCalendarOpen(false);
                  }}
                  onZone={p.onZone}
                />
              </Suspense>
            </PopoverContent>
          </Popover>
        </div>
        {p.children}
      </DialogContent>
    </Dialog>
  );
}
