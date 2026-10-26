import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, X, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { modelKey } from '../../../lib/model-library';
import { FootageFields } from './footage-fields';
import { BucketPicker } from './bucket-picker';
import { BucketForm } from './bucket-form';
import type { WorkshopBucket } from '../models/bucketInferencemodel';
import { ModelPicker } from './model-picker';
import { ConditionInspector } from './condition-inspector';
import { ScheduleFields } from './schedule-fields';
import { SettingsChoices, SettingsRow } from './node-settings-controls';
import type {
  NodeSettingsScreen,
  ScheduleStep,
  WorkflowDraft,
  WorkflowNode,
  WorkflowStep,
  WorkshopCatalog,
} from '../models/workflowInferencemodel';
import type { ModelVersion } from '../../../../src/models/modelInferencemodel';

const screenTitles: Record<NodeSettingsScreen, string> = {
  overview: '',
  bucket: 'Choose a bucket',
  createBucket: 'New labeled bucket',
  camera: 'Camera',
  model: 'Model version',
  parameters: 'Parameters',
  recordedDay: 'Recorded day · UTC',
  sampling: 'Frame interval',
  frameChoice: 'Frame kept',
  timeRange: 'Time range · UTC',
  sourcePreview: 'Source preview',
  trigger: 'Start the workflow',
  followed: 'Follow a workflow',
};

export function NodeInspector({
  node,
  workflowId,
  workflows,
  schedule,
  camera,
  catalog,
  buckets,
  unavailableBuckets,
  inputModel,
  onChange,
  onClose,
  onRemove,
  onOpenBucket,
  onCreateBucket,
}: {
  node: WorkflowNode;
  workflowId: string;
  workflows: WorkflowDraft[];
  schedule?: ScheduleStep;
  camera: string;
  catalog: WorkshopCatalog;
  buckets: WorkshopBucket[];
  unavailableBuckets: string[];
  inputModel?: ModelVersion;
  onChange: (data: WorkflowStep) => void;
  onClose: () => void;
  onRemove: () => void;
  onOpenBucket: (id: string) => void;
  onCreateBucket: (name: string, description: string) => WorkshopBucket;
}) {
  const [screen, setScreen] = useState<NodeSettingsScreen>('overview');
  const body = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<string | undefined>(undefined);
  const focusAfterNavigation = useRef(false);
  const data = node.data;
  const bucket = 'bucketId' in data ? buckets.find(bucket => bucket.id === data.bucketId) : undefined;
  const supported = catalog.models.filter(model => ['object-detection', 'image-classification'].includes(model.task));
  const model = data.kind === 'model' ? supported.find(model => modelKey(model) === data.modelKey) : undefined;
  function navigate(next: NodeSettingsScreen) {
    if (screen === 'overview' && next !== 'overview')
      returnTo.current =
        document.activeElement instanceof HTMLElement ? document.activeElement.dataset.settingsRow : undefined;
    focusAfterNavigation.current = true;
    setScreen(next);
  }
  useLayoutEffect(() => {
    if (body.current) {
      const selected =
        screen === 'bucket' || screen === 'createBucket'
          ? null
          : body.current.querySelector<HTMLElement>('[aria-pressed="true"]');
      body.current.scrollTop = selected ? Math.max(0, selected.offsetTop - 60) : 0;
    }
    if (!focusAfterNavigation.current) return;
    focusAfterNavigation.current = false;
    const origin =
      screen === 'overview'
        ? Array.from(body.current?.querySelectorAll<HTMLElement>('[data-settings-row]') ?? []).find(
            row => row.dataset.settingsRow === returnTo.current,
          )
        : null;
    (origin ?? heading.current)?.focus({ preventScroll: true });
  }, [screen]);
  function choose(value: WorkflowStep) {
    onChange(value);
    navigate('overview');
  }
  if (data.kind === 'model' && screen === 'model') {
    return (
      <ModelPicker
        models={catalog.models}
        value={data.modelKey}
        loading={catalog.loading}
        error={catalog.error}
        onChoose={modelKey => choose({ ...data, modelKey })}
        onBack={() => navigate('overview')}
        onClose={onClose}
      />
    );
  }
  if (data.kind === 'condition')
    return (
      <ConditionInspector data={data} model={inputModel} onChange={onChange} onClose={onClose} onRemove={onRemove} />
    );
  return (
    <section
      className="wk-inspector"
      data-kind={data.kind}
      aria-label={`Configure ${data.label}`}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (screen !== 'overview') navigate(screen === 'createBucket' ? 'bucket' : 'overview');
          else onClose();
        }
      }}
    >
      <header>
        {screen !== 'overview' && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="wk-settings-back"
            aria-label="Back to step settings"
            onClick={() => navigate(screen === 'createBucket' ? 'bucket' : 'overview')}
          >
            <ArrowLeft />
          </Button>
        )}
        <h2 ref={heading} tabIndex={-1}>
          {screenTitles[screen] || data.label}
        </h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close step settings">
          <X />
        </Button>
      </header>
      <div ref={body} className="wk-inspector-body">
        {(data.kind === 'input' || data.kind === 'output') &&
          (screen === 'bucket' ? (
            <BucketPicker
              buckets={buckets}
              value={data.bucketId}
              direction={data.kind}
              unavailable={unavailableBuckets}
              onChoose={bucketId => choose({ ...data, bucketId })}
              onCreate={() => navigate('createBucket')}
            />
          ) : screen === 'createBucket' ? (
            <BucketForm
              onSubmit={(name, description) => {
                const bucket = onCreateBucket(name, description);
                choose({ ...data, bucketId: bucket.id });
              }}
            />
          ) : screen === 'camera' && data.kind === 'input' ? (
            <SettingsChoices
              label="Cameras"
              options={(catalog.overview?.cameras ?? []).map(camera => ({ value: camera, label: camera }))}
              value={data.camera}
              onChoose={camera => choose({ ...data, camera })}
              empty={catalog.loading ? 'Loading cameras…' : 'No cameras available.'}
            />
          ) : (
            <>
              <SettingsRow
                label={data.kind === 'input' ? 'Read from' : 'Write to'}
                value={bucket?.name || 'Choose a bucket'}
                onClick={() => navigate('bucket')}
              />
              {data.kind === 'input' && bucket?.kind === 'raw' && (
                <SettingsRow
                  label="Camera"
                  value={data.camera || 'Choose a camera'}
                  onClick={() => navigate('camera')}
                />
              )}
              <p className="wk-hint wk-settings-note">
                {data.kind === 'output'
                  ? 'Each run will add labeled images to this bucket. Other workflows can use it as an input.'
                  : bucket?.kind === 'raw'
                    ? 'Raw video. Connect a footage filter to select a recorded window and extract frames.'
                    : 'Labeled images. Connect a model or condition directly to reuse these images and their labels.'}
              </p>
              {bucket && (
                <Button variant="outline" className="wk-new-bucket" onClick={() => onOpenBucket(bucket.id)}>
                  Open bucket
                </Button>
              )}
              <p className="wk-hint wk-settings-note">
                Media and labels follow source expiration unless explicitly saved.
              </p>
            </>
          ))}
        {data.kind === 'schedule' && (
          <ScheduleFields
            workflowId={workflowId}
            workflows={workflows}
            data={data}
            onChange={onChange}
            screen={screen}
            onNavigate={navigate}
          />
        )}
        {data.kind === 'nothing' && (
          <p className="wk-hint wk-settings-note">
            Frames that reach this step are checked and then discarded. Nothing is saved to a bucket.
          </p>
        )}
        {data.kind === 'footage' && (
          <FootageFields
            key={`${node.id}/${camera}`}
            camera={camera}
            schedule={schedule}
            data={data}
            onChange={onChange}
            screen={screen}
            onNavigate={navigate}
          />
        )}
        {data.kind === 'model' &&
          (screen === 'parameters' ? (
            <>
              <label className="wk-field">
                <span>Minimum score</span>
                <Input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={data.score}
                  onChange={event => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value) && value >= 0 && value <= 1) onChange({ ...data, score: value });
                  }}
                />
              </label>
              {model && (
                <>
                  <span className="wk-settings-label">Output classes</span>
                  <p className="wk-settings-classes">
                    {model.classes.map(item => item.name).join(', ') || 'No class mapping recorded'}
                  </p>
                </>
              )}
            </>
          ) : (
            <>
              <SettingsRow
                label="Model version"
                value={model ? `${model.name} · ${model.version}` : 'Choose a model'}
                onClick={() => navigate('model')}
              />
              <SettingsRow
                label="Parameters"
                value={`Minimum score ${Math.round(data.score * 100)}%`}
                onClick={() => navigate('parameters')}
              />
            </>
          ))}
      </div>
      {!['input', 'output'].includes(data.kind) && (screen === 'overview' || screen === 'parameters') && (
        <footer>
          <Button variant="ghost" size="sm" onClick={onRemove}>
            <Trash2 />
            Remove step
          </Button>
        </footer>
      )}
    </section>
  );
}
