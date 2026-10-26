import { useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  MarkerType,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  useReactFlow,
} from '@xyflow/react';
import { ArrowLeft, ArrowUpRight, Check, LayoutGrid, Plus, Play, Trash2, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { addStep, removeStep, validateWorkflow } from '../service/workflowInferenceService';
import { arrangeWorkflow, findOpenPosition } from '../utils/workflowLayoutInferenceUtil';
import { workflowSchedule } from '../utils/scheduleInferenceUtil';
import { NodeInspector } from './node-inspector';
import { StepPalette } from './step-palette';
import { upstreamModel } from '../service/conditionInferenceService';
import type { ConditionPreset } from '../models/conditionInferencemodel';
import { RunOutput } from './run-output';
import { useWorkshopRun } from '../hooks/use-workshop-run';
import { useWorkflowViewport } from '../hooks/use-workflow-viewport';
import { useWorkflowCanvas } from '../hooks/use-workflow-canvas';
import { WorkflowNodeContext, workshopNodeTypes } from './workflow-nodes';
import type { AddableStep, WorkflowEditorProps, WorkflowEdge, WorkflowNode } from '../models/workflowInferencemodel';

export function WorkflowEditor(props: WorkflowEditorProps) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}
function Editor({
  workflow,
  workflows,
  buckets,
  catalog,
  theme,
  onUpdate,
  onBack,
  onOpenBucket,
  onCreateBucket,
  onRun,
  onOpenRun,
  saving,
  saveFailed,
  onDelete,
}: WorkflowEditorProps) {
  const canvas = useWorkflowCanvas(workflow, onUpdate, buckets);
  const canvasElement = useRef<HTMLDivElement>(null);
  useWorkflowViewport(canvasElement);
  const { selectedId, selectNode, selectedEdge, selectEdge } = canvas;
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [running, setRunning] = useState(false),
    [runError, setRunError] = useState('');
  const [imageCount, setImageCount] = useState('5');
  const [testId, setTestId] = useState(''),
    [showTest, setShowTest] = useState(false);
  const monitor = useWorkshopRun(testId);
  const testActive = !!testId && (!monitor.run || ['queued', 'running'].includes(monitor.run.status));
  const currentNode =
    monitor.run?.status === 'running' ? monitor.run.jobs.find(j => j.status === 'leased')?.progress?.node_id : null;
  const displayedNodes = useMemo(
    () => canvas.nodes.map(node => (node.id === currentNode ? { ...node, className: 'wk-node-running' } : node)),
    [canvas.nodes, currentNode],
  );
  async function testWorkflow() {
    const problems = validateWorkflow(workflow, catalog.models, buckets, workflows);
    if (problems.length) {
      setChecking(true);
      return;
    }
    if (!onRun) return;
    setRunning(true);
    setRunError('');
    try {
      const id = await onRun({ mode: 'test', image_limit: Number(imageCount) });
      setTestId(id);
      setShowTest(true);
      setAdding(false);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Could not start test.');
    } finally {
      setRunning(false);
    }
  }
  const flow = useReactFlow<WorkflowNode, WorkflowEdge>();
  const selected = workflow.nodes.find(node => node.id === selectedId);
  const camera = workflow.nodes.find(node => node.data.kind === 'input')?.data;
  const issues = useMemo(
    () => (checking ? validateWorkflow(workflow, catalog.models, buckets, workflows) : []),
    [checking, workflow, catalog.models, buckets, workflows],
  );
  const context = useMemo(
    () => ({ models: catalog.models, buckets, workflows, openBucket: onOpenBucket }),
    [catalog.models, buckets, workflows, onOpenBucket],
  );
  function add(kind: AddableStep, preset: ConditionPreset = 'time') {
    const bounds = canvasElement.current?.getBoundingClientRect();
    if (!bounds) return;
    const center = flow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
    const position = findOpenPosition(flow.getNodes(), { x: center.x - 116, y: center.y - 63 });
    const id = crypto.randomUUID();
    onUpdate(current => addStep(current, kind, position, preset, id));
    selectNode(id);
    setAdding(false);
    const screen = flow.flowToScreenPosition(position),
      zoom = flow.getZoom();
    if (
      screen.x < bounds.left + 24 ||
      screen.y < bounds.top + 64 ||
      screen.x + 264 * zoom > bounds.right - 24 ||
      screen.y + 316 * zoom > bounds.bottom - 24
    ) {
      void flow.setCenter(position.x + 132, position.y + 140, { zoom: Math.min(zoom, 1) });
    }
  }
  return (
    <section className="wk-editor" aria-label="Workflow editor">
      <header className="wk-editor-header">
        <div className="wk-editor-title">
          <Button variant="ghost" size="icon" aria-label="Back to workflows" onClick={onBack}>
            <ArrowLeft />
          </Button>
          <label>
            <span className="sr-only">Workflow name</span>
            <Input
              aria-label="Workflow name"
              maxLength={100}
              value={workflow.name}
              onChange={event => onUpdate(current => ({ ...current, name: event.target.value }))}
            />
          </label>
          <span className="wk-draft">{saveFailed ? 'Not saved' : saving ? 'Saving…' : 'Saved'}</span>
          {onDelete && (
            <Button
              className="wk-delete-action"
              variant="ghost"
              size="icon"
              aria-label="Delete workflow"
              title="Delete workflow"
              onClick={onDelete}
            >
              <Trash2 />
            </Button>
          )}
        </div>
        <div className="wk-editor-actions">
          <div className="wk-test-launch">
            <label htmlFor="test-image-count">Images</label>
            <Input
              id="test-image-count"
              aria-label="Test image count"
              type="number"
              min={1}
              max={100}
              step={1}
              value={imageCount}
              disabled={running || testActive}
              onChange={e => setImageCount(e.target.value)}
            />
            <Button
              className="wk-primary"
              disabled={
                !onRun ||
                running ||
                testActive ||
                !Number.isInteger(Number(imageCount)) ||
                Number(imageCount) < 1 ||
                Number(imageCount) > 100
              }
              onClick={() => void testWorkflow()}
            >
              <Play />
              {running ? 'Starting…' : 'Run test'}
            </Button>
          </div>
          {testId && (
            <Button variant="ghost" aria-pressed={showTest} onClick={() => setShowTest(!showTest)}>
              Test output
            </Button>
          )}
          <Button
            className="wk-output-link"
            variant="ghost"
            onClick={() => {
              const output = workflow.nodes.find(node => node.data.kind === 'output')?.data;
              if (output?.kind === 'output' && output.bucketId) onOpenBucket(output.bucketId);
            }}
          >
            Output bucket
            <ArrowUpRight />
          </Button>
          <Button
            variant="secondary"
            aria-label="Check workflow"
            title="Check workflow"
            onClick={() => setChecking(true)}
          >
            <Check />
            <span className="wk-check-label">Check workflow</span>
          </Button>
        </div>
      </header>
      {runError && !checking && (
        <p className="wk-notice" role="alert">
          {runError}
        </p>
      )}
      <div className="wk-editor-body">
        <div ref={canvasElement} className="wk-canvas" aria-label="Workflow canvas">
          <WorkflowNodeContext.Provider value={context}>
            <ReactFlow<WorkflowNode, WorkflowEdge>
              nodes={displayedNodes}
              edges={canvas.edges}
              nodeTypes={workshopNodeTypes}
              onNodesChange={canvas.nodesChanged}
              onEdgesChange={canvas.edgesChanged}
              onNodeDragStop={canvas.commitPositions}
              onNodesDelete={canvas.deleteNodes}
              onEdgesDelete={canvas.deleteEdges}
              onConnect={canvas.connect}
              isValidConnection={canvas.validConnection}
              onNodeClick={(_, node) => {
                selectNode(node.id);
                selectEdge('');
                setAdding(false);
                setShowTest(false);
              }}
              onEdgeClick={(_, edge) => {
                selectEdge(edge.id);
                selectNode('');
              }}
              onPaneClick={() => {
                selectNode('');
                selectEdge('');
                setAdding(false);
              }}
              onMoveEnd={canvas.moveEnd}
              defaultViewport={workflow.viewport}
              fitView={!workflow.viewport}
              fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
              minZoom={0.25}
              maxZoom={1.6}
              colorMode={theme}
              deleteKeyCode={['Backspace', 'Delete']}
              panOnScroll
              selectionOnDrag={false}
              edgesReconnectable={false}
              defaultEdgeOptions={{
                type: 'default',
                markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--wk-wire)' },
              }}
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
              <Controls showInteractive={false} position="bottom-left" />
              <Panel position="top-left" className="wk-canvas-tools">
                <Button
                  variant="secondary"
                  aria-pressed={adding}
                  onClick={() => {
                    setAdding(!adding);
                    setShowTest(false);
                    selectNode('');
                    selectEdge('');
                  }}
                >
                  <Plus />
                  Add step
                </Button>
                <Button
                  variant="outline"
                  aria-label="Arrange workflow"
                  onClick={() => {
                    onUpdate(arrangeWorkflow);
                    requestAnimationFrame(() => void flow.fitView({ padding: 0.15, maxZoom: 1 }));
                  }}
                >
                  <LayoutGrid />
                  <span>Arrange</span>
                </Button>
              </Panel>
              {selectedEdge && (
                <Panel position="top-right">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      onUpdate(current => ({
                        ...current,
                        edges: current.edges.filter(edge => edge.id !== selectedEdge),
                      }));
                      selectEdge('');
                    }}
                  >
                    <X />
                    Remove connection
                  </Button>
                </Panel>
              )}
            </ReactFlow>
          </WorkflowNodeContext.Provider>
        </div>
        <aside
          className="wk-settings-panel"
          aria-label={showTest ? 'Test results' : 'Step settings'}
          data-active={Boolean(selected) || adding || showTest}
          data-run={showTest || undefined}
        >
          {showTest ? (
            <>
              <header className="wk-test-panel-heading">
                <h2>Test run</h2>
                <Button variant="ghost" size="icon" aria-label="Close test results" onClick={() => setShowTest(false)}>
                  <X />
                </Button>
              </header>
              <RunOutput
                {...monitor}
                compact
                onRefresh={monitor.refresh}
                onCancel={() => void monitor.cancel()}
                onOpen={() => onOpenRun?.(testId)}
              />
            </>
          ) : adding ? (
            <StepPalette onAdd={add} onClose={() => setAdding(false)} />
          ) : selected ? (
            <NodeInspector
              key={selected.id}
              node={selected}
              workflowId={workflow.id}
              schedule={workflowSchedule(workflow)}
              workflows={workflows.filter(item => item.id !== workflow.id)}
              inputModel={upstreamModel(workflow, selected.id, catalog.models)}
              camera={camera?.kind === 'input' ? camera.camera : ''}
              catalog={catalog}
              buckets={buckets}
              unavailableBuckets={workflow.nodes.flatMap(node =>
                node.data.kind === (selected.data.kind === 'input' ? 'output' : 'input') && 'bucketId' in node.data
                  ? [node.data.bucketId]
                  : [],
              )}
              onCreateBucket={onCreateBucket}
              onChange={data =>
                onUpdate(current => ({
                  ...current,
                  nodes: current.nodes.map(node => (node.id === selected.id ? { ...node, data } : node)),
                }))
              }
              onClose={() => selectNode('')}
              onRemove={() => {
                onUpdate(current => removeStep(current, selected.id));
                selectNode('');
              }}
              onOpenBucket={onOpenBucket}
            />
          ) : (
            <div className="wk-settings-empty">
              <h2>Step settings</h2>
              <div>
                <h3>Select a node</h3>
                <p>Choose a step on the canvas to edit its settings.</p>
              </div>
            </div>
          )}
        </aside>
      </div>
      <footer className="wk-editor-footer">
        <span>
          {saveFailed ? 'Cloud save needs attention' : saving ? 'Saving to Cloudflare…' : 'Saved to Cloudflare'}
        </span>
        <span>Drag between ports to connect steps</span>
      </footer>
      <Dialog open={checking} onOpenChange={setChecking}>
        <DialogContent className="wk-dialog">
          <DialogTitle>{issues.length ? 'Finish setting up your workflow' : 'Workflow structure is ready'}</DialogTitle>
          <DialogDescription>
            A run takes a fixed snapshot of this workflow and its available inputs. Results appear in the output bucket.
          </DialogDescription>
          {issues.length ? (
            <ul className="wk-issues">
              {issues.map((issue, index) => (
                <li key={index}>
                  <button
                    onClick={() => {
                      selectNode(issue.nodeId ?? '');
                      setChecking(false);
                    }}
                  >
                    {issue.message}
                    <ArrowUpRight />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              The server will verify model compatibility and source availability. Runs are limited to 100 inputs and
              2,000 sampled images.
            </p>
          )}
          {runError && (
            <p role="alert" className="wk-error">
              {runError}
            </p>
          )}
          <Button
            disabled={issues.length > 0 || running || saving || !onRun}
            onClick={async () => {
              setRunning(true);
              setRunError('');
              try {
                await onRun?.({ mode: 'run' });
                setChecking(false);
              } catch (error) {
                setRunError(error instanceof Error ? error.message : 'Could not start run.');
              } finally {
                setRunning(false);
              }
            }}
          >
            {running ? 'Submitting…' : 'Run workflow'}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
