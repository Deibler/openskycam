import { useEffect, useRef, useState } from 'react';
import { pushPage } from '../../../hooks/use-back-to-close';
import type { WorkshopPage, WorkshopRoute } from '../models/workflowInferencemodel';
const pages: WorkshopPage[] = [
  'overview',
  'workflow',
  'editor',
  'buckets',
  'bucket',
  'models',
  'runs',
  'run',
  'review',
];
const param = (page: WorkshopPage) =>
  page === 'run' || page === 'review' ? 'run' : page === 'bucket' ? 'bucket' : 'workflow';
function readRoute(): WorkshopRoute {
  const params = new URLSearchParams(location.search);
  const section = params.get('section');
  const page = (section === 'datasets' ? 'buckets' : section === 'dataset' ? 'bucket' : section) as WorkshopPage;
  // Unknown sections, such as the old workflow list, open the overview.
  const known = pages.includes(page) ? page : params.get('view') === 'models' ? 'models' : 'overview';
  return {
    page: known,
    id: (known === 'bucket' ? (params.get('bucket') ?? params.get('workflow')) : params.get(param(known))) ?? '',
    item: params.get('item') ?? '',
  };
}
const content = () => document.getElementById('workshop-content');
// Where each page was scrolled when it was left, by URL, which an open overlay's entry shares with its page.
const scrolls = new Map<string, number>();
/** Back returns to where the list was; the page may still be loading, so wait up to 3s for it to be tall enough. */
function restoreScroll(top?: number) {
  const until = performance.now() + 3000;
  const step = () => {
    const element = content();
    if (element && element.scrollHeight - element.clientHeight >= (top ?? 0)) element.scrollTop = top ?? 0;
    else if (performance.now() < until) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
export function useWorkshopRoute() {
  const [route, setRoute] = useState(readRoute);
  const shown = useRef(route);
  useEffect(() => {
    shown.current = route;
  }, [route]);
  useEffect(() => {
    const pop = () => {
      const next = readRoute(),
        last = shown.current;
      // An overlay's entry shares its page's URL; leaving it changes nothing here. Within a page (a bucket's feed) the page places itself.
      if (next.page === last.page && next.id === last.id && next.item === last.item) return;
      setRoute(next);
      if (next.page !== last.page || next.id !== last.id) restoreScroll(scrolls.get(location.search));
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  /** `replace` keeps the history entry, for moving within a page such as the next sighting. Entries pushed here are marked `workshop`. */
  function navigate(page: WorkshopPage, id = '', item = '', replace = false) {
    const url = new URL(location.href);
    url.searchParams.set('view', 'workshop');
    url.searchParams.set('section', page);
    for (const key of ['workflow', 'bucket', 'run', 'item']) url.searchParams.delete(key);
    if (id) url.searchParams.set(param(page), id);
    if (item) url.searchParams.set('item', item);
    if (page !== 'models')
      for (const key of ['model', 'modelsTab', 'modelSection', 'modelMode']) url.searchParams.delete(key);
    if (replace) history.replaceState(history.state, '', url);
    else {
      const element = content();
      scrolls.set(location.search, element?.scrollTop ?? 0);
      pushPage({ workshop: true }, url);
      if (element && (page !== shown.current.page || id !== shown.current.id)) element.scrollTop = 0;
    }
    setRoute({ page, id, item });
  }
  return { route, navigate };
}
