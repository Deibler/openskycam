import { createContext, memo, useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ArrowUpRight, CalendarClock, CircleOff, Cpu, Database, Layers, ListFilter } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { modelKey } from '../../../lib/model-library';
import { ConditionNode } from './condition-node';
import type { WorkshopBucket } from '../models/bucketInferencemodel';
import type { WorkflowDraft, WorkflowNode, WorkshopCatalog } from '../models/workflowInferencemodel';
import { isRelativeDay, relativeDays, scheduleSummary } from '../utils/scheduleInferenceUtil';

export const WorkflowNodeContext = createContext<{
  models: WorkshopCatalog['models'];
  buckets: WorkshopBucket[];
  workflows: WorkflowDraft[];
  openBucket: (id: string) => void;
}>({ models: [], buckets: [], workflows: [], openBucket: () => {} });
export const WorkshopNode = memo(function WorkshopNode({ id, data, selected }: NodeProps<WorkflowNode>) {
  const { models, buckets, workflows, openBucket } = useContext(WorkflowNodeContext);
  const model = data.kind === 'model' ? models.find(model => modelKey(model) === data.modelKey) : undefined;
  const bucket = 'bucketId' in data ? buckets.find(bucket => bucket.id === data.bucketId) : undefined;
  if (data.kind === 'condition') return <ConditionNode id={id} data={data} selected={selected} />;
  if (data.kind === 'schedule')
    return (
      <article className="wk-node wk-node-schedule" data-selected={selected || undefined}>
        <div className="wk-node-heading">
          <span className="wk-node-kind">
            <CalendarClock aria-hidden="true" />
            Schedule
          </span>
        </div>
        <strong>{scheduleSummary(data, workflows)}</strong>
        <p>
          {data.trigger === 'arrival'
            ? 'Checks every 15 minutes'
            : data.onlyIf
              ? data.trigger === 'workflow'
                ? 'Only if it saved images'
                : 'Only if there is footage'
              : 'Starts a full run'}
        </p>
        <div className="wk-node-ports" aria-hidden="true">
          <span />
          <span>Start</span>
        </div>
        <Handle type="source" position={Position.Right} id="out" aria-label="Schedule output" />
      </article>
    );
  const Icon = { input: Database, footage: ListFilter, model: Cpu, output: Layers, nothing: CircleOff }[data.kind];
  const kind = {
    input: 'Input bucket',
    footage: 'Footage filter',
    model: 'Model',
    output: 'Output bucket',
    nothing: 'Do nothing',
  }[data.kind];
  return (
    <article className={`wk-node wk-node-${data.kind}`} data-selected={selected || undefined}>
      <Handle
        type="target"
        className="wk-input-port"
        position={Position.Left}
        id="in"
        aria-label={data.kind === 'input' ? `${data.label} schedule` : `${data.label} input`}
      />
      <div className="wk-node-heading">
        <span className="wk-node-kind">
          <Icon aria-hidden="true" />
          {kind}
        </span>
        {data.kind === 'output' && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="nodrag nopan wk-open-bucket"
            aria-label={`Open bucket ${bucket?.name ?? data.label}`}
            disabled={!bucket}
            onClick={() => openBucket(data.bucketId)}
          >
            <ArrowUpRight />
          </Button>
        )}
      </div>
      <strong>{bucket?.name ?? model?.name ?? data.label}</strong>
      {data.kind === 'input' && (
        <p>
          {bucket?.kind === 'raw' ? data.camera || 'Raw video · Choose a camera' : 'Labeled images · Current contents'}
        </p>
      )}
      {data.kind === 'footage' && (
        <p>
          {data.day
            ? `${isRelativeDay(data.day) ? relativeDays[data.day].label : data.day} · ${data.from && data.until ? `${data.from.slice(0, 5)}–${data.until.slice(0, 5)} UTC` : 'Set a time range'}`
            : 'Choose recorded footage'}
        </p>
      )}
      {data.kind === 'model' && (
        <p>
          {model
            ? `${model.version} · ${model.task === 'object-detection' ? 'Detection' : 'Classification'}`
            : 'Choose a model version'}
        </p>
      )}
      {data.kind === 'output' && <p>Images & labels</p>}
      {data.kind === 'nothing' && <p>Skip this frame</p>}
      <div className="wk-node-ports" aria-hidden="true">
        <span>
          {data.kind === 'input'
            ? ''
            : data.kind === 'footage'
              ? 'Video'
              : data.kind === 'model'
                ? 'Images'
                : data.kind === 'nothing'
                  ? 'Any'
                  : 'Labels'}
        </span>
        <span>
          {data.kind === 'input'
            ? bucket?.kind === 'labeled'
              ? 'Labels'
              : 'Video'
            : data.kind === 'footage'
              ? 'Frames'
              : data.kind === 'model'
                ? 'Labels'
                : ''}
        </span>
      </div>
      {!['output', 'nothing'].includes(data.kind) && (
        <Handle type="source" position={Position.Right} id="out" aria-label={`${data.label} output`} />
      )}
    </article>
  );
});
export const workshopNodeTypes = { workshop: WorkshopNode };
