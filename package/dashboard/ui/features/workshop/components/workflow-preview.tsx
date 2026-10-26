import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  MarkerType,
  getNodesBounds,
  useNodesInitialized,
  useReactFlow,
} from '@xyflow/react';
import { WorkflowNodeContext, workshopNodeTypes } from './workflow-nodes';
import type { WorkshopBucket } from '../models/bucketInferencemodel';
import type { WorkflowDraft, WorkflowEdge, WorkflowNode, WorkshopCatalog } from '../models/workflowInferencemodel';

type Size = { width: number; height: number };
// Touch screens draw the steps at a readable size (about 11px text) in a box that scrolls sideways.
const TOUCH_ZOOM = 0.85,
  TOUCH_PAD = 16;

// React Flow's own fitView runs after the first batch of measured steps, which can be one step. Wait for all
// of them. This needs uncontrolled nodes (defaultNodes): React Flow only stores measurements it manages.
function FitWhenMeasured({ onSize }: { onSize?: (size: Size) => void }) {
  const measured = useNodesInitialized(),
    flow = useReactFlow();
  useEffect(() => {
    if (!measured) return;
    if (!onSize) {
      void flow.fitView({ padding: 0.08 });
      return;
    }
    const b = getNodesBounds(flow.getNodes());
    onSize({ width: b.width * TOUCH_ZOOM + TOUCH_PAD * 2, height: b.height * TOUCH_ZOOM + TOUCH_PAD * 2 });
    void flow.setViewport({ x: TOUCH_PAD - b.x * TOUCH_ZOOM, y: TOUCH_PAD - b.y * TOUCH_ZOOM, zoom: TOUCH_ZOOM });
  }, [measured, flow, onSize]);
  return null;
}

/** The workflow as it is set up, read-only: drag to pan, and zoom with the controls. Editing happens in the editor. On a touch screen the box scrolls natively instead, so a vertical swipe still scrolls the page. */
export default function WorkflowPreview({
  workflow,
  workflows,
  buckets,
  catalog,
  theme,
  onBucket,
}: {
  workflow: WorkflowDraft;
  workflows: WorkflowDraft[];
  buckets: WorkshopBucket[];
  catalog: WorkshopCatalog;
  theme: 'light' | 'dark';
  onBucket: (id: string) => void;
}) {
  const touch = useMemo(() => matchMedia('(pointer: coarse)').matches, []);
  const [size, setSize] = useState<Size>();
  const context = useMemo(
    () => ({ models: catalog.models, buckets, workflows, openBucket: onBucket }),
    [catalog.models, buckets, workflows, onBucket],
  );
  return (
    <div className="wk-canvas wk-preview" data-scroll={touch || undefined} aria-label={`${workflow.name} steps`}>
      <div className="wk-preview-track" style={size}>
        <ReactFlowProvider>
          <WorkflowNodeContext.Provider value={context}>
            <ReactFlow<WorkflowNode, WorkflowEdge>
              key={workflow.updatedAt}
              defaultNodes={workflow.nodes}
              defaultEdges={workflow.edges}
              nodeTypes={workshopNodeTypes}
              colorMode={theme}
              minZoom={0.1}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              panOnScroll={false}
              zoomOnScroll={false}
              preventScrolling={false}
              panOnDrag={!touch}
              zoomOnPinch={!touch}
              zoomOnDoubleClick={!touch}
              defaultEdgeOptions={{
                type: 'default',
                markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--wk-wire)' },
              }}
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
              {!touch && <Controls showInteractive={false} position="bottom-left" />}
              <FitWhenMeasured onSize={touch ? setSize : undefined} />
            </ReactFlow>
          </WorkflowNodeContext.Provider>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
