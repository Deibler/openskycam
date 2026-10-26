import { apiRequest } from '../lib/api-request';
import { BrandIndicator, LoadingStatus } from './brand-indicator';
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, KeyRound, MoreHorizontal, Plus, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { ApiDocumentation } from './api-documentation';

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  cameras: string[];
  scope: string;
  pipeline_id?: string;
  device_id?: string | null;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  rotated_at: string | null;
  revoked_at: string | null;
}
interface KeyList {
  devices?: string[];
  pipelines?: string[];
  keys: ApiKeyInfo[];
  cameras: string[];
  max_active_keys: number;
  api_base_url: string;
  environment: string;
}
type Action = { type: 'create' } | { type: 'rename' | 'rotate' | 'revoke'; key: ApiKeyInfo };

const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const mcpCommand = (base: string, token: string) =>
  `claude mcp add --transport http openskycam ${base}/v1/mcp --header "Authorization: Bearer ${token}" --scope user`;
const active = (key: ApiKeyInfo) => !key.revoked_at && Date.parse(key.expires_at) > Date.now();

export function ApiAccess() {
  const createButton = useRef<HTMLButtonElement>(null);
  const actionTrigger = useRef<HTMLButtonElement>(null);
  function restoreFocus() {
    requestAnimationFrame(() => {
      const trigger = actionTrigger.current;
      (trigger?.isConnected && !trigger.disabled ? trigger : createButton.current)?.focus();
    });
  }
  const [data, setData] = useState<KeyList | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action | null>(null);
  const [revealed, setRevealed] = useState<{ token: string; key: ApiKeyInfo } | null>(null);
  const [copied, setCopied] = useState<'' | 'key' | 'command'>('');
  const [copyError, setCopyError] = useState('');
  async function load(signal?: AbortSignal) {
    setLoading(true);
    try {
      setData(await apiRequest<KeyList>('/api/keys', 'GET', undefined, signal));
      setError('');
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Could not load API keys.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);
  async function copy(value: string, what: 'key' | 'command') {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setCopyError('');
    } catch {
      setCopyError('Select the text and copy it manually.');
    }
  }
  const count = data?.keys.filter(active).length ?? 0;
  const [tab, setTab] = useState(new URLSearchParams(location.search).get('tab') === 'docs' ? 'docs' : 'keys');
  return (
    <main className="api-access-view" id="api-access" tabIndex={-1}>
      <div className="api-access-inner">
        <header className="api-page-heading">
          <div>
            <h1>API access</h1>
            <p>Connect your notebooks, scripts, and models to the footage archive.</p>
          </div>
          <Button
            ref={createButton}
            disabled={!data || count >= data.max_active_keys}
            onClick={event => {
              actionTrigger.current = event.currentTarget;
              setAction({ type: 'create' });
            }}
          >
            <Plus />
            Create key
          </Button>
        </header>
        <Tabs
          value={tab}
          onValueChange={value => {
            setTab(value);
            const url = new URL(location.href);
            url.searchParams.set('tab', value);
            history.replaceState(history.state, '', url);
          }}
        >
          <TabsList variant="line" className="api-tabs" aria-label="API access">
            <TabsTrigger value="keys">API keys</TabsTrigger>
            <TabsTrigger value="docs">Documentation</TabsTrigger>
          </TabsList>
          <TabsContent value="keys">
            {data?.environment === 'development' && (
              <p className="api-dev-note">
                Development keys work with this local server. Create production keys on the deployed website.
              </p>
            )}
            {error && (
              <div className="api-inline-error" role="alert">
                {error}
                <Button variant="ghost" onClick={() => void load()}>
                  Retry
                </Button>
              </div>
            )}
            <div className="api-key-list-heading">
              <span>{data ? `${count} active ${count === 1 ? 'key' : 'keys'}` : 'Your keys'}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Refresh API keys"
                disabled={loading}
                onClick={() => void load()}
              >
                {loading && data ? <BrandIndicator /> : <RefreshCw />}
              </Button>
            </div>
            {loading && !data ? (
              <LoadingStatus className="api-empty">Loading keys…</LoadingStatus>
            ) : data?.keys.length === 0 ? (
              <div className="api-empty">
                <KeyRound />
                <h2>Connect with an API key</h2>
                <p>Create a key for Colab or another client. Choose its cameras and expiration.</p>
              </div>
            ) : (
              <ul className="api-key-list">
                {data?.keys.map(key => (
                  <li key={key.id} className={!active(key) ? 'key-inactive' : ''}>
                    <div className="api-key-identity">
                      <strong>{key.name}</strong>
                      <code>{key.prefix}</code>
                      <span>
                        {key.revoked_at
                          ? 'Revoked'
                          : !active(key)
                            ? 'Expired'
                            : key.scope === 'agent'
                              ? 'Agent (MCP and API)'
                              : key.scope === 'processor:run'
                                ? 'Processor'
                                : key.scope === 'models:write'
                                  ? 'Model publisher'
                                  : key.scope === 'workshop:run'
                                    ? `Workshop · ${key.device_id}`
                                    : key.scope === 'models:sync'
                                      ? `Model sync · ${key.device_id}`
                                      : 'Read-only'}{' '}
                        · {key.cameras.join(', ')}
                        {key.pipeline_id ? ` · ${key.pipeline_id}` : ''}
                      </span>
                    </div>
                    <div className="api-key-dates">
                      <span>
                        {key.revoked_at ? `Revoked ${date(key.revoked_at)}` : `Expires ${date(key.expires_at)}`}
                      </span>
                      <small>
                        {key.last_used_at ? `Last used ${new Date(key.last_used_at).toLocaleString()}` : 'Never used'}
                      </small>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Manage ${key.name}`}
                          onFocus={event => {
                            actionTrigger.current = event.currentTarget;
                          }}
                          disabled={Boolean(key.revoked_at)}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="menu-content" align="end">
                        <DropdownMenuItem onSelect={() => setAction({ type: 'rename', key })}>Rename</DropdownMenuItem>
                        <DropdownMenuItem disabled={!active(key)} onSelect={() => setAction({ type: 'rotate', key })}>
                          Rotate secret
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setAction({ type: 'revoke', key })}>
                          Revoke key
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                ))}
              </ul>
            )}
            <p className="api-key-footnote">
              Read-only keys can list and download footage. Processor keys can also claim jobs and submit inference
              results for one pipeline. Model publishing keys upload new versions; device sync keys can only download
              assigned weights. Agent keys give full control through the MCP server, limited to their cameras; an Agent
              key for every camera can also call every website action at /v1 (the website's /api/... path, under /v1).
              Keys cannot manage other keys. Last-used times update at most every five minutes.
            </p>
          </TabsContent>
          <TabsContent value="docs">
            <ApiDocumentation baseUrl={data?.api_base_url ?? location.origin} />
          </TabsContent>
        </Tabs>
      </div>
      {action && data && (
        <KeyAction
          action={action}
          cameras={data.cameras}
          pipelines={data.pipelines ?? []}
          devices={data.devices ?? []}
          onClose={() => {
            setAction(null);
            restoreFocus();
          }}
          onComplete={result => {
            setAction(null);
            if (result.token) {
              setCopied('');
              setCopyError('');
              setRevealed({ token: result.token, key: result.key });
            }
            void load().then(() => {
              if (!result.token) restoreFocus();
            });
          }}
        />
      )}
      <Dialog
        open={Boolean(revealed)}
        onOpenChange={open => {
          if (!open) {
            setRevealed(null);
            setCopied('');
          }
        }}
      >
        <DialogContent
          className="api-key-dialog"
          onCloseAutoFocus={event => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <DialogTitle>Your API key is ready</DialogTitle>
          <DialogDescription>Copy this key now. You won’t be able to see it again.</DialogDescription>
          {revealed && (
            <>
              <label className="api-field">
                {revealed.key.name}
                <textarea
                  aria-label="New API key"
                  readOnly
                  value={revealed.token}
                  autoComplete="off"
                  spellCheck={false}
                  onFocus={e => e.target.select()}
                />
              </label>
              <Button onClick={() => void copy(revealed.token, 'key')}>
                {copied === 'key' ? <Check /> : <Copy />}
                {copied === 'key' ? 'Copied' : 'Copy key'}
              </Button>
              {revealed.key.scope === 'agent' && (
                <>
                  <label className="api-field">
                    Add to Claude Code
                    <textarea
                      aria-label="Claude Code command"
                      readOnly
                      value={mcpCommand(data?.api_base_url ?? location.origin, revealed.token)}
                      autoComplete="off"
                      spellCheck={false}
                      onFocus={e => e.target.select()}
                    />
                  </label>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void copy(mcpCommand(data?.api_base_url ?? location.origin, revealed.token), 'command')
                    }
                  >
                    {copied === 'command' ? <Check /> : <Copy />}
                    {copied === 'command' ? 'Copied' : 'Copy command'}
                  </Button>
                </>
              )}
              {copyError && <p role="status">{copyError}</p>}
              <p className="api-key-footnote">
                {revealed.key.scope === 'agent' ? (
                  <>
                    Other MCP clients: connect to <code>{data?.api_base_url ?? location.origin}/v1/mcp</code> over HTTP
                    with the header <code>Authorization: Bearer</code> and this key. Scripts can call the website's
                    actions with it under <code>/v1</code>, for example <code>GET /v1/workshop</code>.
                  </>
                ) : (
                  <>
                    Use Colab Secrets or an environment variable named <code>SKYVISION_API_KEY</code>.
                  </>
                )}{' '}
                Expires {date(revealed.key.expires_at)}.
              </p>
              <Button variant="ghost" onClick={() => setRevealed(null)}>
                Done
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}

function KeyAction({
  action,
  cameras,
  pipelines,
  devices,
  onClose,
  onComplete,
}: {
  action: Action;
  cameras: string[];
  pipelines: string[];
  devices: string[];
  onClose: () => void;
  onComplete: (result: { key: ApiKeyInfo; token?: string }) => void;
}) {
  const [name, setName] = useState(action.type === 'create' ? '' : action.key.name);
  const [device, setDevice] = useState(devices[0] ?? '');
  const [scope, setScope] = useState('footage:read');
  const [pipeline, setPipeline] = useState(pipelines[0] ?? '');
  const [selected, setSelected] = useState(cameras);
  const [expiry, setExpiry] = useState('90');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = { create: 'Create API key', rename: 'Rename key', rotate: 'Rotate secret', revoke: 'Revoke key' }[
    action.type
  ];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result =
        action.type === 'create'
          ? await apiRequest<{ key: ApiKeyInfo; token: string }>('/api/keys', 'POST', {
              name,
              cameras: scope.startsWith('models:') ? [] : selected,
              expires_in_days: Number(expiry),
              ...(scope !== 'footage:read' ? { scope } : {}),
              ...(scope === 'processor:run' ? { pipeline_id: pipeline } : {}),
              ...(['models:sync', 'workshop:run'].includes(scope) ? { device_id: device } : {}),
            })
          : await apiRequest<{ key: ApiKeyInfo; token?: string }>(
              `/api/keys/${action.key.id}${action.type === 'rotate' ? '/rotate' : ''}`,
              action.type === 'rename' ? 'PATCH' : action.type === 'revoke' ? 'DELETE' : 'POST',
              action.type === 'rename' ? { name } : undefined,
            );
      onComplete(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the key.');
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="api-key-dialog"
        showCloseButton={!busy}
        onCloseAutoFocus={event => event.preventDefault()}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {action.type === 'create'
            ? scope === 'agent'
              ? 'Let an AI agent or a script use openskycam: the MCP server for footage, photos, workflows, runs, images, and models for the cameras you choose, and, for every camera, all website actions under /v1. It cannot manage API keys.'
              : scope === 'workshop:run'
                ? 'Process manually submitted Workshop jobs for this device and the cameras you choose.'
                : scope === 'models:write'
                  ? 'Publish immutable model versions from a training notebook or script.'
                  : scope === 'models:sync'
                    ? 'Download assigned models and report readiness for one device.'
                    : scope === 'processor:run'
                      ? 'Read footage and process jobs for one pipeline and the cameras you choose.'
                      : 'Read-only access to the cameras you choose.'
            : action.type === 'rename'
              ? 'Give this key a recognizable name.'
              : action.type === 'rotate'
                ? `The current secret for “${action.key.name}” will stop working immediately. Update your clients with the new secret. Its cameras and expiry stay the same.`
                : `“${action.key.name}” will stop authorizing new requests. Clients using it will need another key.`}
        </DialogDescription>
        <form onSubmit={submit} className="api-key-form">
          {(action.type === 'create' || action.type === 'rename') && (
            <label className="api-field">
              Name
              <input
                required
                maxLength={80}
                autoComplete="off"
                placeholder="Colab notebook"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </label>
          )}
          {action.type === 'create' && (
            <>
              <label className="api-field">
                Purpose
                <select value={scope} onChange={e => setScope(e.target.value)}>
                  <option value="footage:read">Download footage</option>
                  <option value="agent">Agent: MCP and full API</option>
                  {pipelines.length > 0 && <option value="processor:run">Run inference</option>}
                  <option value="models:write">Publish trained models</option>
                  {devices.length > 0 && <option value="workshop:run">Run Workshop jobs</option>}
                  {devices.length > 0 && <option value="models:sync">Sync device models</option>}
                </select>
              </label>
              {scope === 'processor:run' && (
                <label className="api-field">
                  Pipeline
                  <select value={pipeline} onChange={e => setPipeline(e.target.value)}>
                    {pipelines.map(id => (
                      <option key={id}>{id}</option>
                    ))}
                  </select>
                </label>
              )}
              {['models:sync', 'workshop:run'].includes(scope) && (
                <label className="api-field">
                  Device
                  <select value={device} onChange={e => setDevice(e.target.value)}>
                    {devices.map(id => (
                      <option key={id}>{id}</option>
                    ))}
                  </select>
                </label>
              )}
              {!scope.startsWith('models:') && (
                <fieldset>
                  <legend>Cameras</legend>
                  {cameras.map(camera => (
                    <label className="api-camera-option" key={camera}>
                      <input
                        type="checkbox"
                        checked={selected.includes(camera)}
                        onChange={e =>
                          setSelected(e.target.checked ? [...selected, camera] : selected.filter(c => c !== camera))
                        }
                      />
                      {camera}
                    </label>
                  ))}
                </fieldset>
              )}
              <label className="api-field">
                Expires in
                <select value={expiry} onChange={e => setExpiry(e.target.value)}>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year</option>
                </select>
              </label>
            </>
          )}
          {error && (
            <p className="api-inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="api-dialog-actions">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || (action.type === 'create' && !scope.startsWith('models:') && !selected.length)}
            >
              {busy && <BrandIndicator />}
              {busy ? 'Saving…' : title}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
