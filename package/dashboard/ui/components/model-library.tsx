import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronRight, CloudUpload, Copy, Search, X } from 'lucide-react';
import type { ModelVersion, ModelDeviceDescription } from '../../src/models/modelInferencemodel';
import { canDeploy, groupModels, matchesModel, modelKey, taskLabel } from '../lib/model-library';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { LoadingStatus } from './brand-indicator';
import { apiRequest } from '../lib/api-request';
import { ModelDetails } from './models/model-details';
import { ModelTestWorkspace } from './models/model-test-workspace';
import { DeploymentEditor, DevicesPanel, RegisterDevice } from './models/model-devices';

function readLocation() {
  const params = new URLSearchParams(location.search);
  return {
    model: params.get('model') ?? '',
    tab: params.get('modelsTab') === 'devices' ? 'devices' : 'library',
    section: ['evaluations', 'files'].includes(params.get('modelSection') ?? '')
      ? params.get('modelSection')!
      : 'overview',
    query: params.get('modelQuery') ?? '',
    filter: ['detection', 'classification', 'encoders', 'deployable'].includes(params.get('modelFilter') ?? '')
      ? params.get('modelFilter')!
      : 'all',
    descending: params.get('modelSort') === 'desc',
    testing: params.get('modelMode') === 'test',
  };
}
export function ModelLibrary({ onKeys, embedded = false }: { onKeys: () => void; embedded?: boolean }) {
  const Container = embedded ? 'section' : 'main';
  const [models, setModels] = useState<ModelVersion[] | null>(null);
  const [devices, setDevices] = useState<ModelDeviceDescription[]>([]);
  const [error, setError] = useState('');
  const [route, setRoute] = useState(readLocation);
  const { query, filter } = route;
  const [target, setTarget] = useState<ModelDeviceDescription | null>(null);
  const [registering, setRegistering] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState('');
  const lastFamily = useRef('');
  const requestSequence = useRef(0);
  async function load(signal?: AbortSignal) {
    const sequence = ++requestSequence.current;
    try {
      const [m, d] = await Promise.all([
        apiRequest<{ models: ModelVersion[] }>('/api/models', 'GET', undefined, signal),
        apiRequest<{ devices: ModelDeviceDescription[] }>('/api/models/devices', 'GET', undefined, signal),
      ]);
      if (signal?.aborted || sequence !== requestSequence.current) return;
      setModels(m.models);
      setDevices(d.devices);
      setError('');
    } catch (error) {
      if (!signal?.aborted && sequence === requestSequence.current)
        setError(error instanceof Error ? error.message : 'Could not load the model library.');
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load(controller.signal);
    }, 30000);
    const pop = () => setRoute(readLocation());
    window.addEventListener('popstate', pop);
    return () => {
      controller.abort();
      requestSequence.current++;
      clearInterval(timer);
      window.removeEventListener('popstate', pop);
    };
  }, []);
  function navigate(patch: Partial<typeof route>, replace = false) {
    const next = { ...route, ...patch };
    const url = new URL(location.href);
    for (const [key, value] of [
      ['model', next.model],
      ['modelsTab', next.tab === 'devices' ? 'devices' : ''],
      ['modelSection', next.section === 'overview' ? '' : next.section],
      ['modelQuery', next.query],
      ['modelFilter', next.filter === 'all' ? '' : next.filter],
      ['modelSort', next.descending ? 'desc' : ''],
      ['modelMode', next.testing ? 'test' : ''],
    ]) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    history[replace ? 'replaceState' : 'pushState'](history.state, '', url);
    setRoute(next);
  }
  const allFamilies = groupModels(models ?? []);
  const matchesFilters = (model: ModelVersion) =>
    matchesModel(model, query) &&
    (filter === 'all' ||
      (filter === 'deployable' && canDeploy(model)) ||
      (filter === 'detection' && model.task === 'object-detection') ||
      (filter === 'classification' && model.task.includes('classification')) ||
      (filter === 'encoders' && model.task === 'image-encoder'));
  const families = allFamilies
    .filter(family => family.versions.some(matchesFilters))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) * (route.descending ? -1 : 1));
  const selected = models?.find(m => modelKey(m) === route.model);
  const versions = selected ? (models ?? []).filter(m => m.family === selected.family) : [];
  function selectModel(model: ModelVersion, replace = false) {
    lastFamily.current = model.family;
    navigate({ model: modelKey(model) }, replace);
    requestAnimationFrame(() => document.getElementById('model-detail-title')?.focus({ preventScroll: true }));
  }
  function backToLibrary() {
    navigate({ model: '', testing: false });
    requestAnimationFrame(() =>
      (document.getElementById(`model-family-${lastFamily.current}`) ?? document.getElementById('model-search'))?.focus(
        { preventScroll: true },
      ),
    );
  }
  function clearFilters() {
    navigate({ query: '', filter: 'all' }, true);
  }
  return (
    <Container className="models-view" id="model-library" tabIndex={-1}>
      <div className="models-page">
        <header className="models-heading">
          <h1>Models</h1>
          <Button variant="ghost" aria-label="Connect training" onClick={() => setPublishing(true)}>
            <CloudUpload />
            <span>Connect training</span>
          </Button>
        </header>
        {error && (
          <p className="model-page-error" role="alert">
            {error}
            <Button variant="ghost" onClick={() => void load()}>
              Retry
            </Button>
          </p>
        )}
        {notice && (
          <p className="model-notice" role="status">
            <Check />
            {notice}
            <Button variant="ghost" size="icon" aria-label="Dismiss notification" onClick={() => setNotice('')}>
              <X />
            </Button>
          </p>
        )}
        <Tabs value={route.tab} onValueChange={tab => navigate({ tab })} className="models-main-tabs">
          <TabsList variant="line" className="models-top-tabs" aria-label="Models workspace">
            <TabsTrigger value="library">
              Library<span>{models?.length ?? '—'}</span>
            </TabsTrigger>
            <TabsTrigger value="devices">
              Devices<span>{devices.length}</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="library" className="model-library-workspace" data-detail-open={Boolean(route.model)}>
            {!route.model ? (
              <section className="model-catalog" aria-label="Model catalog">
                <div className="model-catalog-toolbar">
                  <label className="model-search">
                    <Search />
                    <span className="sr-only">Find a model</span>
                    <input
                      id="model-search"
                      type="search"
                      aria-label="Find a model"
                      placeholder="Search models or classes"
                      value={query}
                      onChange={e => navigate({ query: e.target.value }, true)}
                    />
                    {query && (
                      <button type="button" aria-label="Clear search" onClick={() => navigate({ query: '' }, true)}>
                        <X />
                      </button>
                    )}
                  </label>
                  <Select value={filter} onValueChange={filter => navigate({ filter }, true)}>
                    <SelectTrigger aria-label="Filter models">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All models</SelectItem>
                      <SelectItem value="detection">Object detection</SelectItem>
                      <SelectItem value="classification">Classification</SelectItem>
                      <SelectItem value="encoders">Image encoders</SelectItem>
                      <SelectItem value="deployable">Device compatible</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="model-catalog-count" role="status">
                    {models
                      ? `${families.length} ${families.length === 1 ? 'model family' : 'model families'} · ${families.reduce((sum, family) => sum + family.versions.length, 0)} versions`
                      : 'Loading your library'}
                  </p>
                </div>
                <div className="model-catalog-scroll">
                  {!models ? (
                    !error && <LoadingStatus className="model-browser-loading">Loading models…</LoadingStatus>
                  ) : families.length ? (
                    <table className="model-catalog-table">
                      <caption className="sr-only">Your trained models, grouped by family</caption>
                      <thead>
                        <tr>
                          <th scope="col" aria-sort={route.descending ? 'descending' : 'ascending'}>
                            <button type="button" onClick={() => navigate({ descending: !route.descending }, true)}>
                              Model{route.descending ? <ArrowDown /> : <ArrowUp />}
                            </button>
                          </th>
                          <th scope="col">Task</th>
                          <th scope="col">Versions</th>
                          <th scope="col">Assigned to</th>
                          <th scope="col">
                            <span className="sr-only">Open model</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {families.map(family => {
                          const assigned = devices.filter(device =>
                            device.deployment?.models.some(m => m.model.family === family.family),
                          );
                          const representative = family.versions.find(matchesFilters) ?? family.versions[0];
                          const classes = [...new Set(family.versions.flatMap(m => m.classes.map(c => c.name)))];
                          const tasks = [...new Set(family.versions.map(m => taskLabel(m.task)))].join(' / ');
                          const label = `${family.name}, ${family.versions.length} ${family.versions.length === 1 ? 'version' : 'versions'}${assigned.length ? ', assigned' : ''}`;
                          return (
                            <tr key={family.family}>
                              <td>
                                <button
                                  type="button"
                                  id={`model-family-${family.family}`}
                                  className="model-catalog-name"
                                  aria-label={label}
                                  onClick={() => selectModel(representative)}
                                >
                                  <strong>{family.name}</strong>
                                  <span>
                                    {classes.length
                                      ? `${classes.slice(0, 4).join(' · ')}${classes.length > 4 ? ` +${classes.length - 4}` : ''}`
                                      : family.versions.every(m => m.task === 'image-encoder')
                                        ? 'Image representations'
                                        : 'Class mapping not recorded'}
                                  </span>
                                  <span className="model-catalog-mobile-meta">
                                    {tasks} · {family.versions.length}{' '}
                                    {family.versions.length === 1 ? 'version' : 'versions'}
                                    {assigned.length ? ` · ${assigned.map(d => d.id).join(', ')}` : ''}
                                  </span>
                                </button>
                              </td>
                              <td>{tasks}</td>
                              <td className="model-catalog-number">{family.versions.length}</td>
                              <td>
                                {assigned.length ? (
                                  <span className="model-catalog-assigned">{assigned.map(d => d.id).join(', ')}</span>
                                ) : (
                                  <span className="model-catalog-unassigned">Not assigned</span>
                                )}
                              </td>
                              <td>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Open ${family.name}`}
                                  onClick={() => selectModel(representative)}
                                >
                                  <ChevronRight />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="model-search-empty">
                      <h2>{allFamilies.length ? 'No matching models' : 'Your model library starts here'}</h2>
                      <p>
                        {allFamilies.length
                          ? 'Try a model name, class, or another filter.'
                          : 'Connect a training run to publish its weights and model information.'}
                      </p>
                      <Button variant="outline" onClick={allFamilies.length ? clearFilters : () => setPublishing(true)}>
                        {allFamilies.length ? 'Clear filters' : 'Connect a training run'}
                      </Button>
                    </div>
                  )}
                </div>
              </section>
            ) : selected ? (
              route.testing ? (
                <ModelTestWorkspace
                  key={modelKey(selected)}
                  model={selected}
                  devices={devices}
                  onBack={() => {
                    navigate({ testing: false });
                    requestAnimationFrame(() =>
                      document.getElementById('model-detail-title')?.focus({ preventScroll: true }),
                    );
                  }}
                  onDevices={() => navigate({ tab: 'devices' })}
                />
              ) : (
                <ModelDetails
                  key={selected.family}
                  model={selected}
                  versions={versions}
                  devices={devices}
                  section={route.section}
                  onSection={section => navigate({ section }, true)}
                  onVersion={model => selectModel(model, true)}
                  onBack={backToLibrary}
                  onTest={() => {
                    navigate({ testing: true });
                    requestAnimationFrame(() =>
                      document.getElementById('model-test-title')?.focus({ preventScroll: true }),
                    );
                  }}
                  onDevices={() => navigate({ tab: 'devices' })}
                />
              )
            ) : (
              <div className="model-inspector-empty">
                {models ? (
                  <>
                    <h2>Model version not found</h2>
                    <p>Return to the library to choose an available version.</p>
                    <Button variant="outline" onClick={backToLibrary}>
                      Back to library
                    </Button>
                  </>
                ) : (
                  !error && <LoadingStatus>Loading model…</LoadingStatus>
                )}
              </div>
            )}
          </TabsContent>
          <TabsContent value="devices" className="model-devices-scroll">
            <DevicesPanel
              devices={devices}
              onConfigure={setTarget}
              onAdd={() => setRegistering(true)}
              onRefresh={() => void load()}
            />
          </TabsContent>
        </Tabs>
        {target && models && (
          <DeploymentEditor
            device={target}
            models={models}
            onClose={() => setTarget(null)}
            onSaved={() => {
              setNotice(`Configuration sent to ${target.id}. Waiting for its next sync.`);
              setTarget(null);
              void load();
            }}
          />
        )}
        {registering && (
          <RegisterDevice
            onClose={() => setRegistering(false)}
            onSaved={() => {
              setRegistering(false);
              setNotice('Device registered. Create its sync key in API access.');
              void load();
            }}
          />
        )}
        {publishing && <PublishingGuide onClose={() => setPublishing(false)} onKeys={onKeys} />}
      </div>
    </Container>
  );
}
function PublishingGuide({ onClose, onKeys }: { onClose: () => void; onKeys: () => void }) {
  const command = 'skyvision-processor train --metadata model.json --train-config train.json';
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="model-publishing-dialog">
        <div className="model-guide-icon">
          <CloudUpload />
        </div>
        <DialogTitle>From training to your library</DialogTitle>
        <DialogDescription>
          Publish every training run with its weights, classes, and evaluation records.
        </DialogDescription>
        <ol className="model-publishing-steps">
          <li>
            <span>1</span>
            <div>
              <h3>Create a publishing key</h3>
              <p>
                Choose “Publish trained models” in API access. Save it as <code>SKYVISION_API_KEY</code> in your
                training environment.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  onClose();
                  onKeys();
                }}
              >
                API access
                <ArrowUpRight />
              </Button>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <h3>Connect your training run</h3>
              <p>Install the processor package, create your model card and training configuration, then run:</p>
              <div className="model-command">
                <code>{command}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Copy training command"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(command);
                      setCopied(true);
                    } catch {
                      setError('Select the command to copy it manually.');
                    }
                  }}
                >
                  {copied ? <Check /> : <Copy />}
                </Button>
              </div>
              <a
                href="https://docs.openskycam.org/models/#publish-a-model"
                target="_blank"
                rel="noreferrer"
              >
                Setup guide & Colab example
                <ArrowUpRight />
              </a>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <h3>Choose when to deploy</h3>
              <p>
                New versions appear in your library automatically. Assign one under Devices when you’re ready to use it.
              </p>
            </div>
          </li>
        </ol>
        <span className="sr-only" role="status">
          {copied ? 'Command copied' : error}
        </span>
      </DialogContent>
    </Dialog>
  );
}
