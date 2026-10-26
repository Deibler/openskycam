import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  CalendarDays,
  Check,
  ChevronDown,
  Layers,
  Maximize2,
  ScanSearch,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { BucketBrowseFacets } from '../../../../src/models/bucketBrowseInferencemodel';
import type { BrowserFilters } from '../models/browserInferencemodel';
import type { Sighting } from '../models/sightingInferencemodel';
import { dayFilter, emptyFilters, filterDay, sightingDays } from '../utils/browserInferenceUtil';
import { sightingClass, sightingState, topLabel } from '../utils/sightingInferenceUtil';
import { Thumbnail } from './thumbnail';

/** A filter as a pill that opens the platform's own picker. */
function Chip({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="wk-chip" data-active={value !== '' || undefined}>
      <span>{value === '' ? label : (options.find(([v]) => v === value)?.[1] ?? value)}</span>
      <ChevronDown aria-hidden="true" />
      <select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * A bucket's sightings as a grid, newest first under a heading for each day, filtered on the server.
 * Tapping one opens the feed there; in select mode tapping picks all of its photos.
 */
export function DetectionBrowser({
  sightings,
  total,
  facets,
  filters,
  onFilters,
  crop,
  onCrop,
  loading,
  more,
  hasMore,
  onMore,
  onOpen,
  selection,
  onSelection,
}: {
  sightings: Sighting[];
  total: number;
  facets?: BucketBrowseFacets;
  filters: BrowserFilters;
  onFilters: (filters: BrowserFilters) => void;
  crop: boolean;
  onCrop: (crop: boolean) => void;
  loading: boolean;
  more: boolean;
  hasMore: boolean;
  onMore: () => void;
  onOpen: (index: number) => void;
  selection: string[] | null;
  onSelection: (ids: string[] | null) => void;
}) {
  const [filtering, setFiltering] = useState(false),
    sentinel = useRef<HTMLDivElement>(null),
    loadMore = useRef(onMore);
  loadMore.current = onMore;
  const days = useMemo(() => sightingDays(sightings), [sightings]);
  const field = (key: keyof BrowserFilters, value: string) => onFilters({ ...filters, [key]: value });
  const day = filterDay(filters),
    ranged = !day && !!(filters.from || filters.to);
  const refined =
    (['min_confidence', 'max_confidence', 'min_objects', 'max_objects', 'saved'] as const).filter(
      key => filters[key] !== '',
    ).length +
    (ranged ? 1 : 0) +
    (filters.sort !== 'newest' ? 1 : 0);
  const any = Object.entries(filters).some(
    ([key, value]) => key !== 'sort' && value !== emptyFilters[key as keyof BrowserFilters],
  );
  const showClasses = (facets?.classes.length ?? 0) > 1;
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore.current();
      },
      { rootMargin: '800px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, sightings.length]);
  const toggle = (ids: string[]) => {
    if (!selection) return;
    const on = ids.every(id => selection.includes(id));
    onSelection(on ? selection.filter(id => !ids.includes(id)) : [...new Set([...selection, ...ids])]);
  };

  return (
    <div className="wk-grid-page">
      <div className="wk-grid-toolbar">
        <div className="wk-grid-search">
          <label>
            <Search aria-hidden="true" />
            <input
              aria-label="Search detections"
              placeholder="Search labels, cameras, runs"
              value={filters.q}
              onChange={e => field('q', e.target.value)}
            />
            {filters.q && (
              <button type="button" aria-label="Clear search" onClick={() => field('q', '')}>
                <X />
              </button>
            )}
          </label>
          <Button
            variant="ghost"
            size="icon"
            aria-label={crop ? 'Show full frames' : 'Zoom to objects'}
            title={crop ? 'Full frames' : 'Objects'}
            onClick={() => onCrop(!crop)}
          >
            {crop ? <Maximize2 /> : <ScanSearch />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={!!selection}
            onClick={() => onSelection(selection ? null : [])}
          >
            {selection ? 'Done' : 'Select'}
          </Button>
        </div>
        <div className="wk-chips" role="group" aria-label="Filters">
          <button
            type="button"
            className="wk-chip"
            data-active={refined > 0 || undefined}
            aria-expanded={filtering}
            onClick={() => setFiltering(!filtering)}
          >
            <SlidersHorizontal />
            Filters{refined > 0 && <b>{refined}</b>}
          </button>
          <label className="wk-chip" data-active={day !== '' || undefined}>
            <CalendarDays aria-hidden="true" />
            <span>
              {day
                ? new Date(`${day}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                : ranged
                  ? 'Custom dates'
                  : 'Any day'}
            </span>
            <input
              type="date"
              aria-label="Day"
              value={day}
              onClick={e => {
                try {
                  e.currentTarget.showPicker?.();
                } catch {
                  /* The field still opens its own picker. */
                }
              }}
              onChange={e => onFilters({ ...filters, ...dayFilter(e.target.value) })}
            />
          </label>
          <Chip
            label="Status"
            value={filters.review}
            options={[
              ['', 'All'],
              ['pending', 'To review'],
              ['accepted', 'Yes'],
              ['rejected', 'No'],
            ]}
            onChange={value => field('review', value)}
          />
          {(showClasses || filters.class) && (
            <Chip
              label="Label"
              value={filters.class}
              options={[['', 'All labels'], ...(facets?.classes ?? []).map(name => [name, name] as [string, string])]}
              onChange={value => field('class', value)}
            />
          )}
          {((facets?.cameras.length ?? 0) > 1 || filters.camera) && (
            <Chip
              label="Camera"
              value={filters.camera}
              options={[['', 'All cameras'], ...(facets?.cameras ?? []).map(name => [name, name] as [string, string])]}
              onChange={value => field('camera', value)}
            />
          )}
          {((facets?.runs.length ?? 0) > 1 || filters.run) && (
            <Chip
              label="Run"
              value={filters.run}
              options={[
                ['', 'All runs'],
                ...(facets?.runs ?? []).map(
                  run =>
                    [
                      run.id,
                      `${run.name} · ${new Date(run.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`,
                    ] as [string, string],
                ),
              ]}
              onChange={value => field('run', value)}
            />
          )}
          {any && (
            <button
              type="button"
              className="wk-chip wk-chip-clear"
              onClick={() => onFilters({ ...emptyFilters, sort: filters.sort })}
            >
              Clear
              <X />
            </button>
          )}
        </div>
        {filtering && (
          <div className="wk-browser-filters" aria-label="More filters">
            <label>
              Captured from
              <input type="datetime-local" value={filters.from} onChange={e => field('from', e.target.value)} />
            </label>
            <label>
              Captured before
              <input type="datetime-local" value={filters.to} onChange={e => field('to', e.target.value)} />
            </label>
            <fieldset>
              <legend>Confidence (%)</legend>
              <div>
                {(['min_confidence', 'max_confidence'] as const).map((key, i) => (
                  <input
                    key={key}
                    aria-label={i ? 'Maximum confidence' : 'Minimum confidence'}
                    type="number"
                    min="0"
                    max="100"
                    placeholder={i ? '100' : '0'}
                    value={filters[key] === '' ? '' : Math.round(Number(filters[key]) * 100)}
                    onChange={e => field(key, e.target.value === '' ? '' : String(Number(e.target.value) / 100))}
                  />
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Objects per image</legend>
              <div>
                <input
                  aria-label="Minimum objects"
                  type="number"
                  min="0"
                  max="100"
                  placeholder="0"
                  value={filters.min_objects}
                  onChange={e => field('min_objects', e.target.value)}
                />
                <input
                  aria-label="Maximum objects"
                  type="number"
                  min="0"
                  max="100"
                  placeholder="Any"
                  value={filters.max_objects}
                  onChange={e => field('max_objects', e.target.value)}
                />
              </div>
            </fieldset>
            <label>
              Order
              <select value={filters.sort} onChange={e => field('sort', e.target.value)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </label>
            <label className="wk-browser-saved">
              <input
                type="checkbox"
                checked={filters.saved === 'true'}
                onChange={e => field('saved', e.target.checked ? 'true' : '')}
              />
              Saved images only
            </label>
            <footer>
              <small>Capture times are local.</small>
              <Button variant="ghost" size="sm" onClick={() => onFilters({ ...emptyFilters })}>
                Reset filters
              </Button>
            </footer>
          </div>
        )}
      </div>
      <div className="wk-grid-body" aria-label="Detection library" aria-busy={loading}>
        {loading ? (
          <div className="wk-browser-loading" role="status">
            Loading detections…
          </div>
        ) : !sightings.length ? (
          <div className="wk-browser-empty">
            <Search />
            <h3>No detections found</h3>
            <p>{any ? 'Try a wider time or confidence range.' : 'Run a connected workflow to add images here.'}</p>
            {any && (
              <Button variant="outline" onClick={() => onFilters({ ...emptyFilters })}>
                Reset filters
              </Button>
            )}
          </div>
        ) : (
          <>
            <p className="wk-grid-count">
              {total.toLocaleString()} {total === 1 ? 'photo' : 'photos'}
            </p>
            {days.map(({ label, items }) => (
              <section key={label} className="wk-grid-day" aria-label={label}>
                <h3>{label}</h3>
                <div className="wk-grid">
                  {items.map(({ sighting, index }) => {
                    const state = sightingState(sighting),
                      first = new Date(sighting.frames[0].captured_at),
                      ids = sighting.frames.map(f => f.id);
                    const cover = sighting.frames.reduce((best, f) =>
                      (topLabel(f)?.confidence ?? 0) > (topLabel(best)?.confidence ?? 0) ? f : best,
                    );
                    const picked = selection ? ids.every(id => selection.includes(id)) : undefined,
                      saved = sighting.frames.every(f => f.object_key.startsWith('retained/'));
                    return (
                      <button
                        key={sighting.id}
                        type="button"
                        className="wk-tile"
                        data-sighting={sighting.id}
                        aria-pressed={picked}
                        onClick={() => (selection ? toggle(ids) : onOpen(index))}
                        aria-label={`${sightingClass(sighting)}, ${first.toLocaleString()}, ${ids.length} ${ids.length === 1 ? 'photo' : 'photos'}${state === 'accepted' ? ', Yes' : state === 'rejected' ? ', No' : ''}`}
                      >
                        <Thumbnail key={`${cover.id}/${crop}/${cover.annotation_json}`} item={cover} crop={crop} />
                        {(state === 'accepted' || state === 'rejected') && (
                          <span className="wk-tile-status" data-review={state}>
                            {state === 'accepted' ? <Check /> : <X />}
                          </span>
                        )}
                        {ids.length > 1 && (
                          <span className="wk-tile-count">
                            <Layers />
                            {ids.length}
                          </span>
                        )}
                        <span className="wk-tile-caption">
                          {showClasses && <strong>{sightingClass(sighting)}</strong>}
                          <time dateTime={sighting.frames[0].captured_at}>
                            {first.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                          </time>
                          {saved && <Bookmark aria-label="Saved" />}
                        </span>
                        {picked !== undefined && (
                          <span className="wk-tile-check" aria-hidden="true">
                            <Check />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
            <div ref={sentinel} className="wk-browser-footer">
              {hasMore ? (
                <Button variant="outline" onClick={onMore} disabled={more}>
                  {more ? 'Loading…' : 'Load more'}
                </Button>
              ) : (
                <span>That’s everything</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
