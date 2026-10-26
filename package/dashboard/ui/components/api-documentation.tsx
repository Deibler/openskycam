import { LoadingStatus } from './brand-indicator';
import { useEffect, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { Button } from './ui/button';
import { RETENTION_DAYS } from '../../../shared/src/utils/layoutStorageUtil';

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  description: string;
  schema: { type?: string; default?: unknown; minimum?: number; maximum?: number };
}
interface Operation {
  summary: string;
  description?: string;
  parameters?: Parameter[];
  responses: Record<string, { description: string }>;
}
interface Spec {
  paths: Record<
    string,
    {
      parameters?: Parameter[];
      get?: Operation;
      head?: Operation;
      put?: Operation;
      post?: Operation;
      patch?: Operation;
      delete?: Operation;
    }
  >;
}
function Code({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="api-code">
      <div>
        <span>{label}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setFailed(false);
            } catch {
              setFailed(true);
            }
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <pre tabIndex={0}>
        <code>{value}</code>
      </pre>
      {failed && <p role="status">Select the example to copy it manually.</p>}
    </div>
  );
}
export function ApiDocumentation({ baseUrl }: { baseUrl: string }) {
  const [spec, setSpec] = useState<Spec | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/openapi.json', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Could not load the API reference.');
        setSpec(await response.json());
      })
      .catch(e => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  const curl = `curl "${baseUrl}/v1/me" \\\n  -H "Authorization: Bearer $SKYVISION_API_KEY"`;
  const python = `import os\nfrom datetime import datetime, timedelta, timezone\nimport requests\n\n# In Colab: from google.colab import userdata\n# key = userdata.get("SKYVISION_API_KEY")\nkey = os.environ["SKYVISION_API_KEY"]\nheaders = {"Authorization": f"Bearer {key}"}\nnow = datetime.now(timezone.utc)\nparams = {\n    "camera": "sky01",\n    "from": (now - timedelta(hours=1)).isoformat(timespec="seconds"),\n    "to": now.isoformat(timespec="seconds"),\n    "limit": 500,\n}\nurl = "${baseUrl}/v1/recordings"\nrecordings = []\nwhile url:\n    response = requests.get(url, headers=headers, params=params, timeout=30)\n    response.raise_for_status()\n    page = response.json()\n    recordings.extend(page["recordings"])\n    url, params = page["next_url"], None\n\nprint(f"{len(recordings)} recordings available")`;
  const download = `from pathlib import Path
import hashlib

if not recordings:
    raise RuntimeError("No footage in this range")
clip = recordings[0]
path = Path("footage") / clip["object_key"]
path.parent.mkdir(parents=True, exist_ok=True)
partial = path.with_suffix(".mp4.part")
digest = hashlib.sha256()
with requests.get(clip["download_url"], headers=headers,
                  stream=True, timeout=(10, 120)) as response:
    response.raise_for_status()
    with partial.open("wb") as output:
        for chunk in response.iter_content(1024 * 1024):
            output.write(chunk)
            digest.update(chunk)
if digest.hexdigest() != clip["sha256"]:
    raise RuntimeError("Checksum mismatch; retry this download")
partial.replace(path)
print(path)`;
  return (
    <div className="api-documentation">
      <div className="api-doc-intro">
        <div>
          <h2>Read directly from the archive</h2>
          <p>Query by camera and time, then download original MP4 files. All times include a time zone.</p>
        </div>
        <Button variant="outline" asChild>
          <a href="/openapi.json" download="openapi.json">
            <Download />
            OpenAPI JSON
          </a>
        </Button>
      </div>
      <section>
        <h3>Authentication</h3>
        <p>
          Create a key in the API keys tab. Send it in the <code>Authorization</code> header on every request, including
          downloads. Keep it in Colab Secrets or an environment variable.
        </p>
        <Code label="cURL" value={curl} />
      </section>
      <section>
        <h3>Find footage</h3>
        <p>
          The query returns recordings that overlap your time range. Follow <code>next_url</code> until it is null. Each
          item includes file size, SHA-256, and a download URL.
        </p>
        <Code label="Python" value={python} />
      </section>
      <section>
        <h3>Download a recording</h3>
        <p>Run this after the query above. The file is written in chunks and checked before it is marked complete.</p>
        <Code label="Python download" value={download} />
      </section>
      <section>
        <h3>Large downloads</h3>
        <p>
          Download several files concurrently and write response chunks to disk. Reuse verified local files, retry
          transient errors, and use <code>Range: bytes=N-</code> to resume partial files. Check for a <code>206</code>{' '}
          response before appending; a <code>200</code> response replaces the file. Verify the completed file against{' '}
          <code>sha256</code>.
        </p>
        <p>
          The download endpoint streams the original files. Decoding and any frame sampling happen in your client. Raw
          footage follows the archive’s {RETENTION_DAYS}-day retention policy, so a file can expire after it was listed.
        </p>
      </section>
      <section>
        <h3>Inference processors</h3>
        <p>
          Inference is currently a local integration preview. When enabled, create a key with the Run inference purpose
          and select a registered pipeline. Download keys remain read-only.
        </p>
        <p>
          A processor claims one recording, renews its five-minute lease, verifies the original file checksum, then
          submits timestamped tracks and processing metrics. It uploads evidence before completing the job. Results
          identify the model, code, configuration, and source checksums. A completed job with zero tracks is distinct
          from an unprocessed or failed recording.
        </p>
        <p>
          Unsaved results expire {RETENTION_DAYS} days after the recording. Continuous processing and saved detection
          retention are not enabled yet.
        </p>
      </section>
      <section className="api-reference">
        <h3>Endpoint reference</h3>
        <p>This reference is generated from the downloadable OpenAPI specification.</p>
        {error && <p role="alert">{error}</p>}
        {!spec && !error && <LoadingStatus>Loading API reference…</LoadingStatus>}
        {spec &&
          Object.entries(spec.paths).map(([path, methods]) =>
            Object.entries(methods)
              .filter(([method]) => ['get', 'head', 'put', 'post', 'patch', 'delete'].includes(method))
              .map(([method, entry]) => {
                const operation = entry as Operation;
                return (
                  <details key={`${method}${path}`} className="api-endpoint">
                    <summary>
                      <span className="api-method">{method.toUpperCase()}</span>
                      <code>{path}</code>
                      <span>{operation.summary}</span>
                    </summary>
                    <div>
                      <p>{operation.description}</p>
                      {path.startsWith('/api/') && (
                        <p>Requires your signed-in website session. API keys cannot manage credentials.</p>
                      )}
                      {[...(methods.parameters ?? []), ...(operation.parameters ?? [])].length > 0 && (
                        <div className="api-parameter-table">
                          <table>
                            <thead>
                              <tr>
                                <th>Parameter</th>
                                <th>Details</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...(methods.parameters ?? []), ...(operation.parameters ?? [])].map(parameter => (
                                <tr key={`${parameter.in}${parameter.name}`}>
                                  <td>
                                    <code>{parameter.name}</code>
                                    <small>
                                      {parameter.in}
                                      {parameter.required ? ' · required' : ''}
                                    </small>
                                  </td>
                                  <td>{parameter.description}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <h4>Responses</h4>
                      <dl className="api-responses">
                        {Object.entries(operation.responses).map(([status, response]) => (
                          <div key={status}>
                            <dt>{status}</dt>
                            <dd>{response.description}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </details>
                );
              }),
          )}
      </section>
    </div>
  );
}
