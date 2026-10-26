import { ScanSearch } from 'lucide-react';
import type { ReviewFrameProps } from '../models/reviewInferencemodel';
import { imageGeometry } from '../utils/reviewGeometryInferenceUtil';

export function ReviewFrame({ item, imageUrl, temporary, selected = false, onSelect, onInspect }: ReviewFrameProps) {
  const { width, height, annotations } = imageGeometry(item);
  const best = [...annotations].sort((a, b) => b.confidence - a.confidence)[0];
  const time = new Date(item.captured_at).toLocaleString();
  return (
    <article data-selected={selected}>
      <button type="button" className="wk-review-image" onClick={onInspect} aria-label={`Inspect frame at ${time}`}>
        <img
          src={imageUrl ?? `/api/workshop/items/${encodeURIComponent(item.id)}/image`}
          alt={`Camera frame at ${item.captured_at}`}
          width={width}
          height={height}
          loading="lazy"
        />
        {annotations
          .filter(a => a.box)
          .map((a, index) => (
            <span
              key={index}
              aria-hidden="true"
              className="wk-annotation-box"
              style={{
                left: `${a.box![0] * 100}%`,
                top: `${a.box![1] * 100}%`,
                width: `${(a.box![2] - a.box![0]) * 100}%`,
                height: `${(a.box![3] - a.box![1]) * 100}%`,
              }}
            />
          ))}
        {annotations
          .filter(a => a.box && a.box[2] - a.box[0] < 0.025 && a.box[3] - a.box[1] < 0.025)
          .map((a, index) => (
            <span
              key={index}
              aria-hidden="true"
              className="wk-target-locator"
              style={{
                left: `${(a.box![0] + a.box![2]) * 50}%`,
                top: `${(a.box![1] + a.box![3]) * 50}%`,
              }}
            />
          ))}
        <span className="wk-image-inspect-hint" aria-hidden="true">
          <ScanSearch />
        </span>
      </button>
      <div className="wk-image-caption">
        <div className="wk-prediction-summary">
          {onSelect && (
            <label className="wk-image-select">
              <input
                type="checkbox"
                aria-label={`Select image ${item.captured_at}`}
                checked={selected}
                onChange={e => onSelect(e.target.checked)}
              />
            </label>
          )}
          <button type="button" onClick={onInspect} className="wk-prediction-link">
            <strong>{best ? best.class_name : 'No objects found'}</strong>
            {annotations.length > 1 && <span>+{annotations.length - 1}</span>}
            {best && <span className="wk-confidence">{Math.round(best.confidence * 100)}%</span>}
          </button>
        </div>
        <span>
          {time}
          {!temporary && onSelect && ` · ${item.review === 'pending' ? 'Needs review' : item.review}`}
        </span>
        {!temporary && onSelect && (
          <small>
            {item.object_key.startsWith('retained/')
              ? 'Saved'
              : `Expires ${new Date(item.expires_at).toLocaleDateString()}`}
          </small>
        )}
      </div>
    </article>
  );
}
