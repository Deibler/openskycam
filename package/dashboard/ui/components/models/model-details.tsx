import { useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, CheckCircle2, ChevronDown, Copy, Download, Info, Play } from 'lucide-react';
import type { ModelVersion, ModelDeviceDescription } from '../../../src/models/modelInferencemodel';
import { canDeploy, inputSize, metricRows, modelKey, modelSize, taskLabel, textValue } from '../../lib/model-library';
import { Button } from '../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

function CopyValue({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState('');
  return (
    <span className="model-copy">
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setStatus('Copied');
          } catch {
            setStatus('Select the text to copy it.');
          }
        }}
      >
        {status === 'Copied' ? <Check /> : <Copy />}
      </Button>
      <span className="sr-only" role="status">
        {status}
      </span>
    </span>
  );
}
function downloadCard(model: ModelVersion) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${model.family}-${model.version}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ModelDetails({
  model,
  versions,
  devices,
  section,
  onSection,
  onVersion,
  onBack,
  onDevices,
  onTest,
}: {
  model: ModelVersion;
  versions: ModelVersion[];
  devices: ModelDeviceDescription[];
  section: string;
  onSection: (value: string) => void;
  onVersion: (model: ModelVersion) => void;
  onBack: () => void;
  onDevices: () => void;
  onTest: () => void;
}) {
  const assigned = devices.filter(d => d.deployment?.models.some(m => modelKey(m.model) === modelKey(model)));
  const compatible = canDeploy(model);
  return (
    <article className="model-detail-pane" aria-label={`${model.name} details`}>
      <header className="model-detail-header">
        <Button className="model-library-back" variant="ghost" onClick={onBack}>
          <ArrowLeft />
          Library
        </Button>
        <div className="model-detail-title">
          <p className="model-eyebrow">{taskLabel(model.task)}</p>
          <h2 id="model-detail-title" tabIndex={-1}>
            {model.name}
          </h2>
        </div>
        <div className="model-version-control">
          <span>Version</span>
          <Select value={model.version} onValueChange={value => onVersion(versions.find(v => v.version === value)!)}>
            <SelectTrigger aria-label="Model version">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {versions.map(v => (
                <SelectItem key={v.version} value={v.version}>
                  {v.version}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="model-description">{model.description}</p>
        <div className="model-detail-actions">
          <Button className="model-primary-action" onClick={onTest}>
            <Play />
            Test on footage
          </Button>
          <span>
            {assigned.length
              ? `Assigned to ${assigned.map(d => d.id).join(', ')}`
              : compatible
                ? 'Available for device assignment'
                : 'Runtime adapter needed'}
          </span>
        </div>
      </header>
      <Tabs value={section} onValueChange={onSection} className="model-detail-tabs">
        <TabsList variant="line" className="model-section-tabs" aria-label="Model information">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="evaluations">
            Evaluations<span>{model.evaluations.length}</span>
          </TabsTrigger>
          <TabsTrigger value="files">
            Files<span>{model.artifacts.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="model-detail-body">
          <div className="model-overview-content">
            <section className="model-outputs">
              <h3>
                {model.task === 'object-detection'
                  ? 'Detects'
                  : model.task.includes('classification')
                    ? 'Classifies'
                    : 'Output'}
              </h3>
              {model.classes.length ? (
                <>
                  <ul className="model-output-names" aria-label="Output classes">
                    {model.classes.map(c => (
                      <li key={c.id}>{c.name}</li>
                    ))}
                  </ul>
                  <details className="model-secondary-details model-class-mapping">
                    <summary>
                      Class IDs
                      <ChevronDown aria-hidden="true" />
                    </summary>
                    <dl>
                      {model.classes.map(c => (
                        <div key={c.id}>
                          <dt>{c.id}</dt>
                          <dd>{c.name}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </>
              ) : (
                <p className="model-section-caption">
                  {model.task === 'image-encoder'
                    ? 'Image representations for downstream models.'
                    : 'A verified class mapping has not been recorded.'}
                </p>
              )}
            </section>
            <section className="model-specification">
              <h3>Specifications</h3>
              <dl className="model-facts">
                <div>
                  <dt>Training input</dt>
                  <dd>{inputSize(model.input.training_size)}</dd>
                </div>
                <div>
                  <dt>Runtime</dt>
                  <dd>{model.adapter === 'ultralytics' ? 'Ultralytics' : 'Custom architecture'}</dd>
                </div>
                <div>
                  <dt>Stored size</dt>
                  <dd>{modelSize(model.artifacts.reduce((sum, a) => sum + a.bytes, 0))}</dd>
                </div>
              </dl>
            </section>
            <section className="model-device-use">
              <div>
                <h3>Deployment</h3>
                <p className={`model-compatibility ${compatible ? 'is-compatible' : ''}`}>
                  {compatible ? <CheckCircle2 /> : <Info />}
                  {compatible ? 'Device compatible' : 'Runtime adapter needed'}
                </p>
                <p className="model-section-caption">
                  {assigned.length
                    ? `Assigned to ${assigned.map(d => d.id).join(', ')}`
                    : compatible
                      ? 'Not assigned to a device.'
                      : 'This architecture needs a runtime adapter before it can run on a device.'}
                </p>
              </div>
              {compatible && (
                <Button className="model-text-action" variant="ghost" onClick={onDevices}>
                  Manage devices
                  <ArrowUpRight />
                </Button>
              )}
            </section>
            {model.dependencies.length > 0 && (
              <section>
                <h3>Required models</h3>
                <p className="model-section-caption">Include these in the device configuration.</p>
                <ul className="model-dependencies">
                  {model.dependencies.map(d => (
                    <li key={d}>
                      <code>{d}</code>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </TabsContent>
        <TabsContent value="evaluations" className="model-detail-body">
          <ModelEvaluations key={modelKey(model)} model={model} />
        </TabsContent>
        <TabsContent value="files" className="model-detail-body">
          <div className="model-files-content">
            <ul className="model-file-list">
              {model.artifacts.map(a => (
                <li key={a.sha256}>
                  <div className="model-file-heading">
                    <div>
                      <strong>{a.filename}</strong>
                      <span>
                        {a.format.replaceAll('-', ' ')} · {modelSize(a.bytes)}
                      </span>
                    </div>
                  </div>
                  <details className="model-secondary-details model-file-checksum">
                    <summary>
                      SHA-256 checksum
                      <ChevronDown aria-hidden="true" />
                    </summary>
                    <div className="model-checksum">
                      <code>{a.sha256}</code>
                      <CopyValue value={a.sha256} label={`Copy checksum for ${a.filename}`} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
            <section className="model-card-download">
              <div>
                <h3>Model card</h3>
                <p>Class IDs, evaluation records, and file checksums in JSON.</p>
              </div>
              <Button variant="outline" aria-label="Download model card" onClick={() => downloadCard(model)}>
                <Download />
                Download
              </Button>
            </section>
            <p className="model-file-identifier">
              Model ID <code>{modelKey(model)}</code>
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </article>
  );
}

function ModelEvaluations({ model }: { model: ModelVersion }) {
  const [selectedSource, setSelectedSource] = useState('0');
  const evaluation = model.evaluations[Number(selectedSource)] ?? model.evaluations[0];
  return (
    <div className="model-evaluation-content">
      {evaluation ? (
        <>
          {model.evaluations.length > 1 ? (
            <div className="model-evaluation-picker">
              <label id="model-evaluation-label">Evaluation source</label>
              <Select value={selectedSource} onValueChange={setSelectedSource}>
                <SelectTrigger aria-labelledby="model-evaluation-label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {model.evaluations.map((record, index) => (
                    <SelectItem key={index} value={String(index)}>
                      {textValue(record.label ?? `Evaluation ${index + 1}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <h3>{textValue(evaluation.label ?? 'Evaluation')}</h3>
          )}
          <p className="model-evaluation-status">
            {evaluation.independently_reproduced ? 'Independently reproduced' : 'Reported by the training run'}
          </p>
          <dl className="model-evaluation-context">
            <div>
              <dt>Dataset</dt>
              <dd>{textValue(evaluation.dataset)}</dd>
            </div>
            <div>
              <dt>Split</dt>
              <dd>{textValue(evaluation.split)}</dd>
            </div>
            <div>
              <dt>Input</dt>
              <dd>{inputSize(evaluation.input_size)}</dd>
            </div>
          </dl>
          {metricRows(evaluation.metrics).length ? (
            <table className="model-metrics-table">
              <caption className="sr-only">{textValue(evaluation.label ?? 'Evaluation')} metrics</caption>
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">Recorded value</th>
                </tr>
              </thead>
              <tbody>
                {metricRows(evaluation.metrics).map(row => (
                  <tr key={row.key}>
                    <th scope="row" title={row.key}>
                      {row.label}
                    </th>
                    <td>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="model-section-caption">No numeric metrics were recorded.</p>
          )}
          {Boolean(evaluation.source) && (
            <details className="model-secondary-details model-evaluation-provenance" key={selectedSource}>
              <summary>
                Source details
                <ChevronDown aria-hidden="true" />
              </summary>
              <div className="model-evaluation-source">
                {evaluation.source !== null &&
                typeof evaluation.source === 'object' &&
                !Array.isArray(evaluation.source) ? (
                  Object.entries(evaluation.source).map(([key, value]) => (
                    <div key={key}>
                      <span>{key.replaceAll('_', ' ')}</span>
                      <code>{textValue(value)}</code>
                    </div>
                  ))
                ) : (
                  <code>{textValue(evaluation.source)}</code>
                )}
              </div>
            </details>
          )}
        </>
      ) : (
        <div className="model-empty-section">
          <h3>No evaluations yet</h3>
          <p>This version has no recorded evaluation metrics.</p>
        </div>
      )}
      {model.caveats.length > 0 && (
        <details className="model-secondary-details model-evaluation-notes">
          <summary>
            Evaluation notes
            <ChevronDown aria-hidden="true" />
          </summary>
          <ul>
            {model.caveats.map(note => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
