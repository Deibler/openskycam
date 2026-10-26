import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, ListFilter, ScanLine, Search, Tags, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { LoadingStatus } from '../../../components/brand-indicator';
import { canDeploy, inputSize, modelKey, modelSize, taskLabel } from '../../../lib/model-library';
import {
  classFacets,
  classKey,
  creationLabel,
  filterPickerModels,
  groupPickerModels,
  modelDate,
  variantName,
} from '../utils/modelPickerInferenceUtil';
import type { ModelCatalogEntry } from '../../../../src/models/modelInferencemodel';
import type {
  ModelPickerFilters,
  ModelPickerGroup,
  ModelPickerHistoryEntry,
  ModelPickerView,
  PickerTask,
} from '../models/modelPickerInferencemodel';

const tasks = [
  { key: 'object-detection' as const, label: 'Detectors', icon: ScanLine },
  { key: 'image-classification' as const, label: 'Classifiers', icon: Tags },
];

export function ModelPicker({
  models,
  value,
  loading,
  error,
  onChoose,
  onBack,
  onClose,
}: {
  models: ModelCatalogEntry[];
  value: string;
  loading: boolean;
  error: string;
  onChoose: (modelKey: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<ModelPickerView>({ kind: 'browse' });
  const [filters, setFilters] = useState<ModelPickerFilters>({ query: '', task: 'all', classes: [] });
  const [classQuery, setClassQuery] = useState('');
  const panel = useRef<HTMLElement>(null),
    body = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const history = useRef<ModelPickerHistoryEntry[]>([]),
    restore = useRef<ModelPickerHistoryEntry | null>(null);
  const supported = useMemo(
    () => models.filter(model => ['object-detection', 'image-classification'].includes(model.task)),
    [models],
  );
  const filtered = useMemo(() => filterPickerModels(supported, filters), [supported, filters]);
  const groups = useMemo(() => groupPickerModels(filtered), [filtered]);
  const allGroups = useMemo(() => groupPickerModels(supported), [supported]);
  const allClasses = useMemo(() => classFacets(supported), [supported]);
  const contextualClasses = useMemo(
    () => classFacets(filterPickerModels(supported, { ...filters, classes: [] })),
    [supported, filters],
  );
  const visibleClasses = allClasses.filter(
    label =>
      (contextualClasses.some(item => item.key === label.key) || filters.classes.includes(label.key)) &&
      classKey(label.label).includes(classKey(classQuery)),
  );
  const detail = view.kind === 'details' ? models.find(model => modelKey(model) === view.modelKey) : undefined;
  const family =
    view.kind === 'versions'
      ? groups.find(group => group.family === view.family && group.task === view.task)
      : undefined;
  const activeClasses = allClasses.filter(label => filters.classes.includes(label.key));
  const hasFilters = Boolean(filters.query || filters.task !== 'all' || filters.classes.length);
  const classLabel = !activeClasses.length
    ? 'Any class'
    : activeClasses.length === 1
      ? activeClasses[0].label
      : `${activeClasses.length} classes`;

  function navigate(next: ModelPickerView) {
    history.current.push({
      view,
      scrollTop: body.current?.scrollTop ?? 0,
      focusKey: document.activeElement instanceof HTMLElement ? document.activeElement.dataset.pickerFocus : undefined,
    });
    restore.current = null;
    setView(next);
  }
  function back() {
    const previous = history.current.pop();
    if (!previous) {
      onBack();
      return;
    }
    restore.current = previous;
    setView(previous.view);
  }
  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = restore.current?.scrollTop ?? 0;
    const key = restore.current?.focusKey;
    const origin = key
      ? Array.from(panel.current?.querySelectorAll<HTMLElement>('[data-picker-focus]') ?? []).find(
          element => element.dataset.pickerFocus === key,
        )
      : null;
    (origin ?? heading.current)?.focus({ preventScroll: true });
    restore.current = null;
  }, [view]);
  function setTask(task: PickerTask) {
    setFilters(current => ({ ...current, task }));
    if (body.current) body.current.scrollTop = 0;
  }
  function toggleClass(key: string) {
    setFilters(current => ({
      ...current,
      classes: current.classes.includes(key)
        ? current.classes.filter(value => value !== key)
        : [...current.classes, key],
    }));
  }
  function reset() {
    setFilters({ query: '', task: 'all', classes: [] });
    if (body.current) body.current.scrollTop = 0;
  }
  function openFamily(group: ModelPickerGroup) {
    const total =
      allGroups.find(item => item.family === group.family && item.task === group.task)?.versions.length ??
      group.versions.length;
    navigate(
      total === 1
        ? { kind: 'details', modelKey: modelKey(group.versions[0]) }
        : { kind: 'versions', family: group.family, task: group.task },
    );
  }
  const backLabel = !history.current.length
    ? 'Back to step settings'
    : history.current.at(-1)?.view.kind === 'versions'
      ? 'Back to versions'
      : 'Back to models';

  return (
    <section
      ref={panel}
      className="wk-inspector wk-model-picker"
      aria-label="Choose a workflow model"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          back();
        }
      }}
    >
      <header>
        <Button variant="ghost" size="icon-sm" aria-label={backLabel} onClick={back}>
          <ArrowLeft />
        </Button>
        <h2 ref={heading} tabIndex={-1}>
          {view.kind === 'classes'
            ? 'Filter by class'
            : view.kind === 'details'
              ? 'Model details'
              : view.kind === 'versions'
                ? 'Choose a version'
                : 'Choose a model'}
        </h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close step settings">
          <X />
        </Button>
      </header>
      {view.kind === 'browse' && (
        <div className="wk-model-toolbar">
          <label className="wk-choice-search">
            <Search aria-hidden="true" />
            <Input
              type="search"
              aria-label="Search models"
              placeholder="Search models or classes"
              value={filters.query}
              onChange={event => {
                setFilters(current => ({ ...current, query: event.target.value }));
                if (body.current) body.current.scrollTop = 0;
              }}
            />
          </label>
          <div className="wk-model-type-tabs" role="group" aria-label="Model type">
            <Button variant="ghost" aria-pressed={filters.task === 'all'} onClick={() => setTask('all')}>
              All
            </Button>
            {tasks.map(({ key, label, icon: Icon }) => (
              <Button key={key} variant="ghost" aria-pressed={filters.task === key} onClick={() => setTask(key)}>
                <Icon aria-hidden="true" />
                {label}
              </Button>
            ))}
          </div>
          <div className="wk-model-filter-row">
            <Button
              variant="outline"
              data-picker-focus="classes"
              aria-label={`Filter by class: ${classLabel}`}
              onClick={() => {
                setClassQuery('');
                navigate({ kind: 'classes' });
              }}
            >
              <ListFilter aria-hidden="true" />
              <span>{classLabel}</span>
              <ChevronRight aria-hidden="true" />
            </Button>
            {hasFilters && (
              <Button variant="ghost" onClick={reset}>
                Clear
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="wk-inspector-body" ref={body}>
        {view.kind === 'browse' && (
          <>
            <p className="sr-only" role="status">
              {groups.length} model {groups.length === 1 ? 'family' : 'families'}, {filtered.length}{' '}
              {filtered.length === 1 ? 'version' : 'versions'}
            </p>
            {loading && !models.length ? (
              <LoadingStatus>Loading models…</LoadingStatus>
            ) : !filtered.length ? (
              <div className="wk-model-no-results">
                <h3>{error ? 'Models unavailable' : 'No matching models'}</h3>
                <p>
                  {error
                    ? 'Use Retry above the editor to reload the library.'
                    : hasFilters
                      ? 'Try another class or clear your filters.'
                      : 'Publish a detection or classification model to get started.'}
                </p>
                {hasFilters && (
                  <Button variant="outline" onClick={reset}>
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <div className="wk-model-families">
                {tasks
                  .filter(task => groups.some(group => group.task === task.key))
                  .map(({ key }) => (
                    <section key={key} aria-label={taskLabel(key)}>
                      {filters.task === 'all' && (
                        <h3 className="wk-model-group-label">
                          {key === 'object-detection' ? 'Object detection' : 'Image classification'}
                        </h3>
                      )}
                      <ul>
                        {groups
                          .filter(group => group.task === key)
                          .map(group => {
                            const total =
                              allGroups.find(item => item.family === group.family && item.task === key)?.versions
                                .length ?? group.versions.length;
                            const current = group.versions.some(model => modelKey(model) === value);
                            return (
                              <li key={`${key}/${group.family}`}>
                                <Button
                                  variant="ghost"
                                  className="wk-model-family-row"
                                  data-picker-focus={`family:${key}/${group.family}`}
                                  aria-label={`Open ${group.name}`}
                                  onClick={() => openFamily(group)}
                                >
                                  <span>
                                    <strong>{group.name}</strong>
                                    <span>
                                      {group.versions.length < total
                                        ? `${group.versions.length} of ${total} versions match`
                                        : `${total} ${total === 1 ? 'version' : 'versions'}`}
                                      {current && (
                                        <span className="wk-model-current">
                                          <Check aria-hidden="true" />
                                          In this step
                                        </span>
                                      )}
                                    </span>
                                  </span>
                                  <ChevronRight aria-hidden="true" />
                                </Button>
                              </li>
                            );
                          })}
                      </ul>
                    </section>
                  ))}
              </div>
            )}
          </>
        )}
        {family && (
          <>
            <div className="wk-model-family-intro">
              <p>{taskLabel(family.task)}</p>
              <h3>{family.name}</h3>
              <span>
                {family.versions.length} {family.versions.length === 1 ? 'version' : 'versions'}
                {hasFilters ? ' matching your filters' : ' available'}
              </span>
            </div>
            <ul className="wk-model-version-list" aria-label={`${family.name} versions`}>
              {family.versions.map(model => (
                <li key={modelKey(model)}>
                  <Button
                    variant="outline"
                    className="wk-model-version-row"
                    data-selected={modelKey(model) === value || undefined}
                    data-picker-focus={modelKey(model)}
                    aria-label={`View ${model.name} ${model.version} details`}
                    onClick={() => navigate({ kind: 'details', modelKey: modelKey(model) })}
                  >
                    <span>
                      <strong>{variantName(model)}</strong>
                      <span className="wk-model-version-id">
                        Version {model.version}
                        {modelKey(model) === value && (
                          <span className="wk-model-current">
                            <Check aria-hidden="true" />
                            In this step
                          </span>
                        )}
                      </span>
                      <span className="wk-model-date">{creationLabel(model)}</span>
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
        {view.kind === 'classes' && (
          <>
            <p className="wk-model-filter-help">Find models that recognize any of these classes.</p>
            <label className="wk-choice-search">
              <Search aria-hidden="true" />
              <Input
                type="search"
                aria-label="Search classes"
                placeholder="Search classes"
                value={classQuery}
                onChange={event => setClassQuery(event.target.value)}
              />
            </label>
            <ul className="wk-model-class-options" aria-label="Class filters">
              {visibleClasses.map(label => {
                const count = contextualClasses.find(item => item.key === label.key)?.count ?? 0;
                return (
                  <li key={label.key}>
                    <label>
                      <input
                        type="checkbox"
                        checked={filters.classes.includes(label.key)}
                        onChange={() => toggleClass(label.key)}
                      />
                      <span>{label.label}</span>
                      <small>
                        {count} {count === 1 ? 'version' : 'versions'}
                      </small>
                    </label>
                  </li>
                );
              })}
            </ul>
            {!visibleClasses.length && <p className="wk-hint">No matching classes. Try another search.</p>}
            {filters.classes.length > 0 && (
              <Button variant="ghost" onClick={() => setFilters(current => ({ ...current, classes: [] }))}>
                Clear selected classes
              </Button>
            )}
          </>
        )}
        {detail && <PickerModelDetails model={detail} />}
      </div>
      {view.kind === 'classes' && (
        <footer>
          <Button className="wk-primary" onClick={back}>
            Show models
          </Button>
        </footer>
      )}
      {detail && (
        <footer>
          <Button className="wk-primary" onClick={() => onChoose(modelKey(detail))}>
            Use this version
          </Button>
        </footer>
      )}
    </section>
  );
}

function PickerModelDetails({ model }: { model: ModelCatalogEntry }) {
  const source = {
    publisher: 'Reported by publisher',
    checkpoint: 'Recorded in checkpoint',
    'legacy-manifest': 'Recorded in legacy manifest',
  };
  const legacyDiffers =
    model.creation?.legacy_date && model.creation.date?.slice(0, 10) !== model.creation.legacy_date.slice(0, 10);
  const url = `/?view=workshop&section=models&model=${encodeURIComponent(modelKey(model))}`;
  return (
    <article className="wk-picker-detail" aria-label={`${model.name} details`}>
      <p className="wk-eyebrow">{taskLabel(model.task)}</p>
      <h3>{model.name}</h3>
      <p className="wk-picker-version">Version {model.version}</p>
      <p className="wk-picker-description">{model.description}</p>
      <section className="wk-picker-output">
        <h4>Recognizes</h4>
        {model.classes.length ? (
          <p>{model.classes.map(label => label.name).join(', ')}</p>
        ) : (
          <p>Class list not recorded</p>
        )}
      </section>
      <dl className="wk-picker-facts">
        <div>
          <dt>Created</dt>
          <dd>
            {model.creation?.status === 'unavailable' ? 'Date unavailable' : modelDate(model.creation?.date)}
            {model.creation?.source && <small>{source[model.creation.source]}</small>}
          </dd>
        </div>
        {legacyDiffers && (
          <div>
            <dt>Legacy training date</dt>
            <dd>
              {modelDate(model.creation.legacy_date)}
              <small>Differs from checkpoint date</small>
            </dd>
          </div>
        )}
        <div>
          <dt>Added to library</dt>
          <dd>{modelDate(model.registered_at)}</dd>
        </div>
        <div>
          <dt>Training input</dt>
          <dd>{inputSize(model.input.training_size)}</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>{model.adapter === 'ultralytics' ? 'Ultralytics' : 'Custom architecture'}</dd>
        </div>
        <div>
          <dt>Files</dt>
          <dd>
            {model.artifacts.length} · {modelSize(model.artifacts.reduce((total, item) => total + item.bytes, 0))}
          </dd>
        </div>
      </dl>
      {!canDeploy(model) && (
        <p className="wk-picker-runtime-note">This model needs a runtime adapter before it can run on a device.</p>
      )}
      <a className="wk-picker-library-link" href={url} target="_blank" rel="noopener noreferrer">
        Full model details
        <ArrowUpRight aria-hidden="true" />
        <span className="sr-only"> (opens model library in a new tab)</span>
      </a>
    </article>
  );
}
