import { useState } from 'react';
import { CheckCircle2, Cpu, Info, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import type { ModelVersion, ModelDeviceDescription, ModelSelection } from '../../../src/models/modelInferencemodel';
import { canDeploy, modelKey, modelSize } from '../../lib/model-library';
import { apiRequest } from '../../lib/api-request';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { BrandIndicator } from '../brand-indicator';

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Request failed. Please try again.');
export function DevicesPanel({
  devices,
  onConfigure,
  onRefresh,
  onAdd,
}: {
  devices: ModelDeviceDescription[];
  onConfigure: (device: ModelDeviceDescription) => void;
  onRefresh: () => void;
  onAdd: () => void;
}) {
  return (
    <section className="model-devices-pane" aria-label="Model devices">
      <header className="model-devices-intro">
        <div>
          <h2>Your devices</h2>
          <p>Assign the models each device needs. Everything else stays in your library.</p>
        </div>
        <div>
          <Button variant="ghost" size="icon" aria-label="Refresh devices" onClick={onRefresh}>
            <RefreshCw />
          </Button>
          <Button variant="outline" onClick={onAdd}>
            <Plus />
            Add device
          </Button>
        </div>
      </header>
      {devices.length ? (
        <ul className="model-devices">
          {devices.map(device => {
            const ready = device.status === 'ready' && device.revision === device.reported_revision;
            const status = ready
              ? 'Models ready'
              : device.status === 'error'
                ? 'Update failed'
                : device.revision
                  ? 'Sync pending'
                  : 'Unassigned';
            return (
              <li key={device.id}>
                <header>
                  <span className="model-device-icon">
                    <Cpu />
                  </span>
                  <div>
                    <h3>{device.id}</h3>
                    <p>
                      {device.last_seen_at
                        ? `Last synced ${new Date(device.last_seen_at).toLocaleString()}`
                        : 'Waiting for the device to connect'}
                    </p>
                  </div>
                  <span className={`model-compatibility ${ready ? 'is-compatible' : ''}`}>
                    {ready ? <CheckCircle2 /> : <Info />}
                    {status}
                  </span>
                </header>
                <div className="model-device-assignment">
                  <div className="model-device-table-heading">
                    <span>Assigned models</span>
                    <span>Inference settings</span>
                  </div>
                  {device.deployment?.models.length ? (
                    device.deployment.models.map(binding => (
                      <div className="model-device-binding" key={binding.slot}>
                        <div>
                          <strong>{binding.model.name}</strong>
                          <p>
                            <code>{binding.slot}</code>
                            <span>
                              {binding.model.version} · {modelSize(binding.artifact.bytes)}
                            </span>
                          </p>
                        </div>
                        <dl>
                          <div>
                            <dt>Input</dt>
                            <dd>{binding.parameters.imgsz} px</dd>
                          </div>
                          <div>
                            <dt>Confidence</dt>
                            <dd>{binding.parameters.confidence}</dd>
                          </div>
                          <div>
                            <dt>Compute</dt>
                            <dd>
                              {binding.parameters.device === 'auto'
                                ? 'Auto'
                                : binding.parameters.device === 'mps'
                                  ? 'Apple GPU'
                                  : binding.parameters.device === 'cuda'
                                    ? 'NVIDIA GPU'
                                    : 'CPU'}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    ))
                  ) : (
                    <p className="model-device-empty">Choose a model to prepare this device for inference.</p>
                  )}
                </div>
                <footer>
                  {device.error ? (
                    <p role="status">Update failed. The previous models are retained.</p>
                  ) : (
                    <p>Verified downloads · Unused weights removed after activation</p>
                  )}
                  <Button variant="secondary" onClick={() => onConfigure(device)}>
                    <Settings2 />
                    Configure
                  </Button>
                </footer>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="model-empty-section">
          <Cpu />
          <h3>Connect your first device</h3>
          <p>Register its name, assign a model, then create a device sync key.</p>
          <Button onClick={onAdd}>Add device</Button>
        </div>
      )}
      <p className="model-device-footnote">
        <Info />
        Model readiness confirms download and runtime validation. Continuous inference is enabled separately.
      </p>
    </section>
  );
}

export function DeploymentEditor({
  device,
  models,
  onClose,
  onSaved,
}: {
  device: ModelDeviceDescription;
  models: ModelVersion[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const available = models.filter(canDeploy);
  const [selection, setSelection] = useState<ModelSelection[]>(
    device.deployment?.models.map(m => ({
      slot: m.slot,
      family: m.model.family,
      version: m.model.version,
      sha256: m.artifact.sha256,
      parameters: m.parameters,
    })) ?? [],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function choose(model: ModelVersion, slot: string): ModelSelection {
    const native = model.input.training_size;
    const candidate = typeof native === 'number' ? native : Array.isArray(native) ? Number(native[0]) : 640;
    const imgsz = candidate >= 32 && candidate <= 2048 && candidate % 32 === 0 ? candidate : 640;
    return {
      slot,
      family: model.family,
      version: model.version,
      sha256: model.artifacts.find(a => a.filename.endsWith('.pt'))!.sha256,
      parameters: { imgsz, confidence: 0.3, iou: 0.5, device: 'auto' },
    };
  }
  function update(index: number, patch: Partial<ModelSelection>) {
    setSelection(items => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  function addModel() {
    let slot = 'detector';
    let number = 1;
    while (selection.some(item => item.slot === slot)) slot = `model-${++number}`;
    setSelection(items => [...items, choose(available[0], slot)]);
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="model-editor"
        placement="right"
        onInteractOutside={e => e.preventDefault()}
        onOpenAutoFocus={e => {
          const firstModel = document.getElementById('model-binding-0-version');
          if (firstModel) {
            e.preventDefault();
            firstModel.focus();
          }
        }}
      >
        <header className="model-editor-header">
          <p className="model-eyebrow">Device configuration</p>
          <DialogTitle>{device.id}</DialogTitle>
          <DialogDescription>Pin a version and tune its inference settings.</DialogDescription>
        </header>
        <form
          onSubmit={async e => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await apiRequest(`/api/models/devices/${device.id}/deployment`, 'PUT', {
                previous_revision: device.revision,
                models: selection,
              });
              onSaved();
            } catch (error) {
              setError(errorMessage(error));
              setBusy(false);
            }
          }}
        >
          <div className="model-editor-scroll">
            {selection.map((item, index) => {
              const model = models.find(m => m.family === item.family && m.version === item.version)!;
              const prefix = `model-binding-${index}`;
              return (
                <fieldset className="model-binding" key={index} disabled={busy}>
                  <legend>Model {index + 1}</legend>
                  <div className="model-binding-title">
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{model.name}</strong>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${item.slot}`}
                      onClick={() => setSelection(items => items.filter((_, i) => i !== index))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="api-field">
                    <label htmlFor={`${prefix}-version`}>Model & version</label>
                    <Select
                      value={modelKey(model)}
                      onValueChange={value =>
                        update(index, choose(available.find(m => modelKey(m) === value)!, item.slot))
                      }
                    >
                      <SelectTrigger id={`${prefix}-version`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {available.map(m => (
                          <SelectItem key={modelKey(m)} value={modelKey(m)}>
                            {m.name} · {m.version}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="model-binding-fields">
                    <label className="api-field">
                      Role
                      <input
                        required
                        pattern="[a-z0-9][a-z0-9._-]{0,63}"
                        value={item.slot}
                        onChange={e => update(index, { slot: e.target.value })}
                      />
                    </label>
                    <div className="api-field">
                      <label htmlFor={`${prefix}-checkpoint`}>Checkpoint</label>
                      <Select value={item.sha256} onValueChange={sha256 => update(index, { sha256 })}>
                        <SelectTrigger id={`${prefix}-checkpoint`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {model.artifacts
                            .filter(a => a.filename.endsWith('.pt'))
                            .map(a => (
                              <SelectItem key={a.sha256} value={a.sha256}>
                                {a.filename} · {modelSize(a.bytes)}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="model-parameters">
                    {(['imgsz', 'confidence', 'iou'] as const).map(key => (
                      <label className="api-field" key={key}>
                        {key === 'imgsz' ? 'Input size (px)' : key === 'iou' ? 'IoU threshold' : 'Confidence'}
                        <input
                          type="number"
                          min={key === 'imgsz' ? 32 : 0}
                          max={key === 'imgsz' ? 2048 : 1}
                          step={key === 'imgsz' ? 32 : 0.01}
                          required
                          value={item.parameters[key]}
                          onChange={e =>
                            update(index, { parameters: { ...item.parameters, [key]: Number(e.target.value) } })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <div className="api-field">
                    <label htmlFor={`${prefix}-compute`}>Compute</label>
                    <Select
                      value={item.parameters.device}
                      onValueChange={value =>
                        update(index, {
                          parameters: { ...item.parameters, device: value as ModelSelection['parameters']['device'] },
                        })
                      }
                    >
                      <SelectTrigger id={`${prefix}-compute`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Automatic</SelectItem>
                        <SelectItem value="mps">Apple GPU</SelectItem>
                        <SelectItem value="cuda">NVIDIA GPU</SelectItem>
                        <SelectItem value="cpu">CPU</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </fieldset>
              );
            })}
            <Button
              type="button"
              className="model-add-binding"
              variant="outline"
              disabled={busy || !available.length || selection.length >= 16}
              onClick={addModel}
            >
              <Plus />
              Add model
            </Button>
            {!selection.length && (
              <p className="model-section-caption">
                No models selected. Applying this configuration removes all weights from the managed runtime.
              </p>
            )}
            {error && (
              <p className="api-inline-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <footer className="model-editor-footer">
            <p>Replacements are verified before activation.</p>
            <div>
              <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <BrandIndicator />}
                {busy ? 'Saving…' : 'Apply configuration'}
              </Button>
            </div>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RegisterDevice({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="model-small-dialog">
        <DialogTitle>Add a device</DialogTitle>
        <DialogDescription>Give your runtime a name, then create its sync key in API access.</DialogDescription>
        <form
          className="api-key-form"
          onSubmit={async e => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await apiRequest('/api/models/devices', 'POST', { id: name });
              onSaved();
            } catch (error) {
              setError(errorMessage(error));
              setBusy(false);
            }
          }}
        >
          <label className="api-field">
            Device ID
            <input
              required
              pattern="[a-z0-9][a-z0-9._-]{0,63}"
              placeholder="gpu-box"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <small>Lowercase letters, numbers, hyphens or underscores.</small>
          </label>
          {error && (
            <p className="api-inline-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? 'Registering…' : 'Register device'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
