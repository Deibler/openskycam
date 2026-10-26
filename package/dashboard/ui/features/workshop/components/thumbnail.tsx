import { useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { WorkshopRunImage } from '../../../../src/models/workshopInferencemodel';
import { thumbnailUrl, tileFraming } from '../utils/browserInferenceUtil';
import { usePhotoTurn } from '../hooks/use-photo-turn';

/**
 * A photo filling its tile: the object (`crop`), or the full frame slid to keep the object in view.
 * If the server cannot make the thumbnail, the full photo stands in, framed the same way, once the
 * tile is on screen and its turn comes.
 */
export function Thumbnail({ item, crop }: { item: WorkshopRunImage; crop: boolean }) {
  const ref = useRef<HTMLSpanElement>(null),
    [failed, setFailed] = useState(false),
    [loaded, setLoaded] = useState(false),
    [turn, done] = usePhotoTurn(ref, failed);
  const original = failed && turn;
  return (
    <span ref={ref} className="wk-tile-image" data-loaded={loaded || undefined}>
      {(!failed || turn) && (
        <img
          key={original ? 'original' : 'thumbnail'}
          src={original ? item.image_url : thumbnailUrl(item, crop, true)}
          alt=""
          // A turn is given on screen; a lazy load could wait off screen and never pass it on.
          loading={original ? undefined : 'lazy'}
          decoding="async"
          draggable={false}
          style={tileFraming(item, crop, original)}
          onLoad={() => {
            setLoaded(true);
            done();
          }}
          onError={() => (original ? done() : setFailed(true))}
        />
      )}
      {!loaded && (
        <span className="wk-thumbnail-placeholder" aria-hidden="true">
          <ImageIcon />
        </span>
      )}
    </span>
  );
}
