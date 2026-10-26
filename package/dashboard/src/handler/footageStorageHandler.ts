import { privateJson } from '../../../shared/src/utils/httpSharedUtil';
import { compactTimestamp } from '../../../shared/src/utils/layoutStorageUtil';
import { listRecordings } from '../service/footageStorageService';
import type { Handler } from '../../../shared/src/models/routerSharedmodel';
import type { MachineApp } from '../models/applicationSharedmodel';
export const footageHandler: Handler<MachineApp> = async (_request, app, _params, url) => {
  const page = await listRecordings(app.env, app.principal, {
    camera: url.searchParams.get('camera'),
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    limit: url.searchParams.get('limit'),
    cursor: url.searchParams.get('cursor'),
  });
  const next = new URL(url);
  if (page.next_cursor) next.searchParams.set('cursor', page.next_cursor);
  return privateJson({
    ...page,
    recordings: page.recordings.map(row => ({
      ...row,
      download_url: `${url.origin}/v1/recordings/${encodeURIComponent(page.camera)}/${compactTimestamp(new Date(row.start))}/file`,
    })),
    next_url: page.next_cursor ? next.toString() : null,
  });
};
