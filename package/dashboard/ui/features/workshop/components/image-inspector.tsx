import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import type { ImageInspectorProps } from '../models/reviewInferencemodel';
import { imageGeometry, objectView } from '../utils/reviewGeometryInferenceUtil';

export function ImageInspector({ item, imageUrl, onClose }: ImageInspectorProps) {
  const { width, height, annotations } = imageGeometry(item);
  const [active, setActive] = useState(annotations.findIndex(a => a.box));
  const [focused, setFocused] = useState(active >= 0);
  const [outlines, setOutlines] = useState(true);
  const selected = annotations[active];
  const view = objectView(width, height, focused ? selected?.box : undefined);
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="wk-image-inspector">
        <header>
          <DialogTitle>Inspect frame</DialogTitle>
          <DialogDescription>{new Date(item.captured_at).toLocaleString()}</DialogDescription>
        </header>
        <div className="wk-inspector-controls">
          <Button variant={!focused ? 'secondary' : 'ghost'} onClick={() => setFocused(false)}>
            Full frame
          </Button>
          <Button variant={focused ? 'secondary' : 'ghost'} disabled={!selected?.box} onClick={() => setFocused(true)}>
            Focus object
          </Button>
          <Button variant="ghost" aria-pressed={outlines} onClick={() => setOutlines(!outlines)}>
            {outlines ? 'Hide outlines' : 'Show outlines'}
          </Button>
        </div>
        <div className="wk-inspection-media">
          <svg
            viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
            role="img"
            aria-label={focused && selected ? `Magnified ${selected.class_name} prediction` : 'Full camera frame'}
          >
            <image href={imageUrl ?? `/api/workshop/items/${encodeURIComponent(item.id)}/image`} width={width} height={height} />
            {outlines &&
              annotations.map(
                (a, index) =>
                  a.box && (
                    <rect
                      key={index}
                      x={a.box[0] * width}
                      y={a.box[1] * height}
                      width={(a.box[2] - a.box[0]) * width}
                      height={(a.box[3] - a.box[1]) * height}
                      fill="none"
                      className="wk-inspection-outline"
                      stroke="var(--osc-sky)"
                      strokeWidth={index === active ? 1.5 : 1}
                      vectorEffect="non-scaling-stroke"
                    />
                  ),
              )}
          </svg>
        </div>
        <footer className="wk-inspection-predictions" aria-label="Model predictions">
          {annotations.length ? (
            annotations.map((a, index) => (
              <button
                type="button"
                key={index}
                aria-pressed={active === index}
                onClick={() => {
                  setActive(index);
                  setFocused(!!a.box);
                }}
              >
                {annotations.length > 1 && <span>{index + 1}</span>}
                <strong>{a.class_name}</strong>
                <span>{Math.round(a.confidence * 100)}%</span>
                {a.box && (
                  <small>
                    {Math.max(1, Math.round((a.box[2] - a.box[0]) * width))} ×{' '}
                    {Math.max(1, Math.round((a.box[3] - a.box[1]) * height))} px
                  </small>
                )}
              </button>
            ))
          ) : (
            <p>No objects predicted in this frame.</p>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
