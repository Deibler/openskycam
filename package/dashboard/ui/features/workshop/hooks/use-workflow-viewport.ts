import { useEffect, type RefObject } from 'react';
import { useNodesInitialized, useReactFlow } from '@xyflow/react';

/** Preserve the saved view unless a resize or restored viewport hides every node. */
export function useWorkflowViewport(canvas: RefObject<HTMLDivElement | null>) {
  const initialized = useNodesInitialized();
  const flow = useReactFlow();
  useEffect(() => {
    const element = canvas.current;
    if (!element || !initialized) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = element.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const nodes = Array.from(element.querySelectorAll<HTMLElement>('.react-flow__node'));
        const visible = nodes.some(node => {
          const box = node.getBoundingClientRect();
          return (
            box.right > bounds.left + 24 &&
            box.left < bounds.right - 24 &&
            box.bottom > bounds.top + 64 &&
            box.top < bounds.bottom - 24
          );
        });
        if (nodes.length && !visible) void flow.fitView({ padding: 0.18, maxZoom: 1 });
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [canvas, flow, initialized]);
}
