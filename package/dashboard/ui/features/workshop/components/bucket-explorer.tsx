import { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Check, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { apiRequest } from '../../../lib/api-request';
import type { BucketItemDetail } from '../../../../src/models/bucketBrowseInferencemodel';
import type { BrowserPreferences } from '../models/browserInferencemodel';
import { readBrowserPreferences, writeBrowserPreferences } from '../db/BucketBrowserInferenceOps';
import { emptyFilters } from '../utils/browserInferenceUtil';
import { decidedLabels, groupSightings, topLabel } from '../utils/sightingInferenceUtil';
import { useBucketBrowser } from '../hooks/use-bucket-browser';
import { useReviewDecisions } from '../hooks/use-review-decisions';
import { BucketFeed } from './bucket-feed';
import { DetectionBrowser } from './detection-browser';

/**
 * A bucket like a profile: its sightings in a filterable grid, each opening a full-screen feed.
 * `onItem(id, true)` records opening the feed as a visit, so Back closes it.
 */
export function BucketExplorer({
  bucketId,
  title = 'Bucket',
  itemId = '',
  initialRun = '',
  onItem,
  onEditState,
  onLeave = action => action(),
}: {
  bucketId: string;
  title?: string;
  itemId?: string;
  initialRun?: string;
  onItem?: (id: string, visit?: boolean) => void;
  onEditState?: (dirty: boolean, busy: boolean) => void;
  /** Runs `action` now, or after the person agrees to drop unsaved marks. */
  onLeave?: (action: () => void) => void;
}) {
  const [preferences, setPreferences] = useState<BrowserPreferences>(() => {
    const saved = readBrowserPreferences(bucketId);
    return {
      filters: { ...emptyFilters, ...saved.filters, ...(initialRun ? { run: initialRun } : {}) },
      crop: saved.crop ?? true,
    };
  });
  const browser = useBucketBrowser(bucketId, preferences.filters);
  // Decisions update the grid's own photos, which both the grid and the feed show.
  const decisions = useReviewDecisions(items => items.forEach(browser.updateItem));
  const items = browser.page?.items ?? [];
  // ponytail: sightings regroup only when photos arrive or leave, so a label edit never reshuffles an open feed.
  const groups = useMemo(() => {
    const all = groupSightings(items);
    return preferences.filters.sort === 'oldest' ? all : all.reverse();
  }, [items.map(item => item.id).join(), preferences.filters.sort]);
  const sightings = useMemo(() => {
    const byId = new Map(items.map(item => [item.id, item]));
    return groups.map(s => ({ ...s, frames: s.frames.map(f => byId.get(f.id) ?? f) }));
  }, [groups, items]);
  const [feed, setFeed] = useState<{ start: number; visit: boolean } | null>(null),
    linked = useRef(''),
    focused = useRef('');
  const [selection, setSelection] = useState<string[] | null>(null),
    [retaining, setRetaining] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    writeBrowserPreferences(bucketId, preferences);
  }, [bucketId, preferences]);
  // Losing the link (Back) closes the feed; a link to a photo opens the feed on it once the grid holds it.
  useEffect(() => {
    if (!itemId) {
      linked.current = '';
      setFeed(null);
    }
  }, [itemId]);
  useEffect(() => {
    if (!itemId || linked.current === itemId) return;
    if (feed) {
      linked.current = itemId;
      return;
    }
    const at = sightings.findIndex(s => s.frames.some(f => f.id === itemId));
    if (at >= 0) {
      linked.current = itemId;
      setFeed({ start: at, visit: false });
    }
  }, [itemId, sightings]);

  function open(at: number) {
    focused.current = sightings[at].frames[0].id;
    setFeed({ start: at, visit: true });
    onItem?.(focused.current, true);
  }
  function close() {
    const visit = feed?.visit;
    setFeed(null);
    const tile = sightings.find(s => s.frames.some(f => f.id === focused.current));
    requestAnimationFrame(() =>
      (tile && document.querySelector(`[data-sighting="${tile.id}"]`))?.scrollIntoView?.({ block: 'center' }),
    );
    if (visit) history.back();
    else onItem?.('');
  }
  async function decide(review: 'accepted' | 'rejected') {
    setError('');
    const result = await decisions.apply(
      items
        .filter(item => selection?.includes(item.id))
        .map(item => [
          item,
          review,
          review === 'accepted' ? decidedLabels(item, topLabel(item)?.class_name ?? '') : undefined,
        ]),
    );
    if (result.failed) setError(`Couldn’t save ${result.failed} photos. ${result.message}`);
    else setSelection(null);
  }
  /** Copies each image beyond its source's expiration, then reads it back so the grid shows it saved. */
  async function retain(ids: string[]) {
    setBusy(true);
    setError('');
    try {
      for (const id of ids) {
        await apiRequest(`/api/workshop/items/${encodeURIComponent(id)}/save`, 'POST', {});
        browser.updateItem(
          (await apiRequest<BucketItemDetail>(`/api/workshop/items/${encodeURIComponent(id)}`, 'GET')).item,
        );
      }
      setRetaining([]);
      setSelection(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save images.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wk-bucket-explorer">
      {(browser.error || error) && !retaining.length && (
        <div className="wk-browser-error">
          <p role="alert">{browser.error || error}</p>
          <Button
            variant="ghost"
            onClick={() => {
              setError('');
              browser.reload();
            }}
          >
            Retry
          </Button>
        </div>
      )}
      <DetectionBrowser
        sightings={sightings}
        total={browser.page?.total ?? 0}
        facets={browser.page?.facets}
        filters={preferences.filters}
        onFilters={filters => {
          setPreferences(p => ({ ...p, filters }));
          setSelection(s => s && []);
        }}
        crop={preferences.crop}
        onCrop={crop => setPreferences(p => ({ ...p, crop }))}
        loading={browser.loading}
        more={browser.more}
        hasMore={!!browser.page?.cursor && !browser.error}
        onMore={() => void browser.loadMore()}
        onOpen={open}
        selection={selection}
        onSelection={setSelection}
      />
      {selection && (
        <div className="wk-select-bar" role="toolbar" aria-label="Selected photos">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelection(selection.length ? [] : items.map(item => item.id))}
          >
            {selection.length ? `${selection.length} selected · Clear` : 'Select all'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Save selected images"
            disabled={!selection.length || busy}
            onClick={() => setRetaining(selection)}
          >
            <Bookmark />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Reject selected images"
            disabled={!selection.length || busy}
            onClick={() => void decide('rejected')}
          >
            <X />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Accept selected images"
            disabled={!selection.length || busy}
            onClick={() => void decide('accepted')}
          >
            <Check />
          </Button>
        </div>
      )}
      {feed && (
        <BucketFeed
          title={title}
          total={browser.page?.total ?? 0}
          sightings={sightings}
          start={feed.start}
          decisions={decisions}
          hasMore={!!browser.page?.cursor && !browser.error}
          onMore={() => void browser.loadMore()}
          runName={id => browser.page?.facets.runs.find(run => run.id === id)?.name ?? 'Run'}
          onRetain={setRetaining}
          onFocus={id => {
            focused.current = id;
            onItem?.(id);
          }}
          onBack={() => onLeave(close)}
          onEditState={onEditState}
        />
      )}
      <Dialog
        open={retaining.length > 0}
        onOpenChange={open => {
          if (!open && !busy) {
            setRetaining([]);
            setError('');
          }
        }}
      >
        <DialogContent>
          <DialogTitle>
            Save {retaining.length} {retaining.length === 1 ? 'image' : 'images'} and labels
          </DialogTitle>
          <DialogDescription>
            Keep these images, their labels, and provenance beyond source expiration. The original video keeps its
            existing expiration. Create a new dataset version after saving to include the retained lifetime.
          </DialogDescription>
          {error && <p role="alert">{error}</p>}
          <Button disabled={busy} onClick={() => void retain(retaining)}>
            {busy ? 'Saving…' : 'Save images and labels'}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
