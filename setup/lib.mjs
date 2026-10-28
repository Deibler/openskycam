/** The parts of the setup guide that need no network, host or person: parsing and validation. Tested by lib.check.mjs. */

/** Reads KEY=value lines, including `KEY = value`, quoted values and inline comments. */
export function parseEnv(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const value = match[2];
    const single = /^'((?:[^']|'\\'')*)'/.exec(value);
    const double = /^"([^"]*)"/.exec(value);
    // As Node's loader reads it (quotes end a value; an unquoted one ends at an inline comment), plus bash's
    // '\'' escape inside single quotes, which only bash readers such as external/relay/deploy.sh rely on.
    values[match[1]] = single
      ? single[1].replaceAll(`'\\''`, `'`)
      : double
        ? double[1]
        : value.replace(/\s+#.*$/, '');
  }
  return values;
}

/**
 * A value as .env holds it. Bash sources .env (external/relay/deploy.sh) and Node loads it
 * (package/shared/deploy-config.mjs): plain values read the same in both, anything else is single-quoted.
 */
export function quote(value) {
  return /^[A-Za-z0-9_./:@,+=%-]*$/.test(value) ? value : `'${value.replaceAll(`'`, `'\\''`)}'`;
}

/** Sets keys in .env text: an existing line is replaced where it stands, a new key is added at the end. */
export function setEnv(text, values) {
  const lines = text ? text.replace(/\n$/, '').split('\n') : [];
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${quote(String(value))}`;
    const at = lines.findIndex(l => new RegExp(`^\\s*${key}\\s*=`).test(l));
    if (at === -1) lines.push(line);
    else lines[at] = line;
  }
  return `${lines.join('\n')}\n`;
}

/** The account and tunnel IDs inside a Cloudflare Tunnel token, which is base64 JSON {a, t, s}. */
export function parseTunnelToken(token) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(token.trim(), 'base64').toString('utf8'));
  } catch {
    throw new Error('That is not a tunnel token. Copy the long string after --token in the install command.');
  }
  if (!/^[0-9a-f-]{36}$/.test(parsed?.t ?? '') || !parsed.a || !parsed.s)
    throw new Error('That is not a tunnel token. Copy the long string after --token in the install command.');
  return { accountId: parsed.a, tunnelId: parsed.t };
}

/** Bucket names from `wrangler r2 bucket list`. */
export function parseBuckets(text) {
  return [...text.matchAll(/^name:\s+(\S+)/gm)].map(m => m[1]);
}

/** IDs and names from the table `wrangler vpc service list` prints. */
export function parseVpcServices(text) {
  return [...text.matchAll(/│\s*([0-9a-f]{8}-[0-9a-f-]{27})\s*│\s*(\S+)\s*│/g)].map(m => ({ id: m[1], name: m[2] }));
}

/** The ingest Worker's workers.dev address from `wrangler deploy` output. */
export function ingestUrl(text) {
  return /https:\/\/skyvision-ingest\.[a-z0-9-]+\.workers\.dev/.exec(text)?.[0];
}

/** `myteam`, `myteam.cloudflareaccess.com` or its URL, as https://myteam.cloudflareaccess.com. */
export function teamDomain(value) {
  const team = value
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.cloudflareaccess\.com$/, '');
  return /^[a-z0-9-]+$/i.test(team) ? `https://${team.toLowerCase()}.cloudflareaccess.com` : undefined;
}

/** Each returns a problem to show, or undefined when the value is fine. */
export const problems = {
  host: v =>
    /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v)
      ? undefined
      : 'Enter a hostname such as sky.example.com, without https://.',
  ssh: v => (/^[A-Za-z0-9._@-]+$/.test(v) ? undefined : 'Enter an SSH host such as pi@relay.local or a Host alias.'),
  folder: v => (/^\/[^'"\n]*$/.test(v) ? undefined : 'Enter an absolute path, such as /mnt/footage.'),
  camera: v =>
    /^[a-z0-9][a-z0-9-]{0,31}$/.test(v) ? undefined : 'Use up to 32 lowercase letters, digits and hyphens.',
  device: v =>
    /^[a-z0-9][a-z0-9._-]{0,63}$/.test(v)
      ? undefined
      : 'Use up to 64 lowercase letters, digits, dots, underscores and hyphens.',
  aud: v => (/^[a-f0-9]{64}$/.test(v) ? undefined : 'The audience tag is 64 hexadecimal characters.'),
  team: v => (teamDomain(v) ? undefined : 'Enter your team name or https://<team>.cloudflareaccess.com.'),
  port: v => (/^\d{1,5}$/.test(v) && +v > 0 && +v < 65536 ? undefined : 'Enter a port number.'),
  path: v => (v.startsWith('/') ? undefined : 'The path starts with /.'),
  address: v => (/^[A-Za-z0-9.:-]+$/.test(v) ? undefined : 'Enter the camera address, such as 192.168.1.20.'),
};

/**
 * The camera stream URL, for the setup guide's stream check and external/relay/deploy.sh alike.
 * The login is percent-encoded here, so .env holds it as the camera expects it (camera_mcp.py sends it as is).
 */
export function rtspUrl(env) {
  const login = `${encodeURIComponent(env.CAMERA_USERNAME)}:${encodeURIComponent(env.CAMERA_PASSWORD)}`;
  return `rtsp://${login}@${env.CAMERA_IP_ADDRESS}:${env.CAMERA_RTSP_PORT || 554}${env.CAMERA_RTSP_PATH || '/cam/realmonitor?channel=1&subtype=0'}`;
}

/** Text from a tool that was given `url`, without the URL or any user:password@ in it. */
export function redactUrl(text, url) {
  return text.replaceAll(url, '<camera stream>').replace(/\/\/[^/@\s]*@/g, '//');
}
