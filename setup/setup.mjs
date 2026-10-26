/**
 * Guided setup: the steps of docs/deploy.md, run for you where a command can do them and explained where
 * only the Cloudflare dashboard or the website can. Answers are saved to .env as you go, so you can stop
 * and run it again: finished steps are checked and skipped.
 *
 *   npm run setup               set up everything that is not done yet
 *   npm run setup -- relay      run one step again (cloudflare, hosts, storage, store, access, website,
 *                               ingest, relay, processor)
 *   npm run setup -- --check    check every step and change nothing
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import * as lib from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
const wranglerBin = path.join(root, 'package/dashboard/node_modules/.bin/wrangler');
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const only = args.find(a => !a.startsWith('--'));
let env = fs.existsSync(envFile) ? lib.parseEnv(fs.readFileSync(envFile, 'utf8')) : {};

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = code => text => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);
const [bold, dim, green, red, yellow] = [paint(1), paint(2), paint(32), paint(31), paint(33)];

// ---- Prompts ----------------------------------------------------------------------------------------------

// Input is read only while a question waits, so commands run in between (wrangler login, sudo over SSH)
// get the keyboard. The terminal stays in its normal mode; secrets are hidden by turning echo off.
const rl = readline.createInterface({ input: process.stdin, terminal: false });
const lines = [];
const waiting = [];
let ended = false;
rl.on('line', line => {
  if (waiting.length) waiting.shift().resolve(line);
  else lines.push(line);
  if (!waiting.length) rl.pause();
});
rl.on('close', () => {
  ended = true;
  for (const w of waiting.splice(0)) w.reject(new Error('Input ended before setup finished.'));
});
rl.pause();
function nextLine() {
  if (lines.length) return Promise.resolve(lines.shift());
  if (ended) return Promise.reject(new Error('Input ended before setup finished.'));
  return new Promise((resolve, reject) => {
    waiting.push({ resolve, reject });
    rl.resume();
  });
}
const echo = on => process.stdin.isTTY && spawnSync('stty', [on ? 'echo' : '-echo'], { stdio: ['inherit', 'ignore', 'ignore'] });
process.on('SIGINT', () => {
  echo(true);
  process.exit(130);
});

/** Asks until the answer passes `problem`. Enter keeps the current value. Secrets are not echoed. */
async function ask(label, { initial = '', secret = false, problem } = {}) {
  for (;;) {
    const current = initial ? dim(secret ? ' [Enter keeps the saved one]' : ` [${initial}]`) : '';
    process.stdout.write(`  ${label}${current}: `);
    if (secret) echo(false);
    const answer = (await nextLine().finally(() => secret && echo(true))).trim();
    if (secret && process.stdin.isTTY) process.stdout.write('\n');
    const value = answer || initial;
    const issue = value ? problem?.(value) : 'An answer is needed.';
    if (!issue) return value;
    console.log(`  ${red(issue)}`);
  }
}
async function confirm(label, yes = true) {
  process.stdout.write(`  ${label} ${dim(yes ? '[Y/n]' : '[y/N]')} `);
  const answer = (await nextLine()).trim().toLowerCase();
  return answer ? answer.startsWith('y') : yes;
}
async function pause(text = 'Press Enter when that is done.') {
  process.stdout.write(`  ${dim(text)} `);
  await nextLine();
}
function say(text = '') {
  console.log(text ? `  ${text}` : '');
}
function openUrl(url) {
  say(`Opening ${bold(url)}`);
  spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
}

// ---- Commands ---------------------------------------------------------------------------------------------

/**
 * Runs a command. With `quiet` or `input`, its output is captured instead of shown: `out` is standard output
 * alone, for reading values (SSH and Wrangler print notices on standard error), and `all` is both, for errors.
 */
function run(command, argv, { cwd = root, input, quiet = false } = {}) {
  const capture = quiet || input !== undefined;
  const result = spawnSync(command, argv, {
    cwd,
    input,
    encoding: 'utf8',
    stdio: [input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
  });
  return { ok: result.status === 0, out: result.stdout ?? '', all: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}
/** Shows a command's output and also returns it. */
function runShown(command, argv, cwd) {
  return new Promise(resolve => {
    const child = spawn(command, argv, { cwd, stdio: ['inherit', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', chunk => {
      out += chunk;
      process.stdout.write(chunk);
    });
    child.on('close', status => resolve({ ok: status === 0, out }));
  });
}
const wrangler = (argv, options) => run(wranglerBin, argv, { quiet: true, ...options });
const ssh = (host, script, input) =>
  run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, script], { quiet: true, input });
const sshTerminal = (host, script) => run('ssh', ['-t', host, script]).ok;

async function http(url, init = {}) {
  try {
    const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    return { status: response.status, text: await response.text() };
  } catch (error) {
    return { status: 0, text: String(error.cause?.code ?? error.message) };
  }
}
const json = text => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};
const api = (path, key, init = {}) =>
  http(`https://${env.API_HOST}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...init.headers },
  });

/** Polls `test` until it returns a truthy value, for at most `seconds`. */
async function waitFor(what, seconds, test) {
  const end = Date.now() + seconds * 1000;
  process.stdout.write(`  ${dim(`Waiting for ${what}…`)}`);
  for (;;) {
    const value = await test();
    if (value || Date.now() > end) {
      process.stdout.write(value ? ` ${green('done')}\n` : ` ${red('not yet')}\n`);
      return value;
    }
    await new Promise(r => setTimeout(r, 5000));
  }
}

function save(values) {
  env = { ...env, ...values };
  const text = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
  fs.writeFileSync(envFile, lib.setEnv(text, values), { mode: 0o600 });
}

/** Asks for an SSH host until key-based login works. */
async function sshHost(label, key) {
  for (;;) {
    const host = await ask(label, { initial: env[key], problem: lib.problems.ssh });
    if (ssh(host, 'true').ok) {
      save({ [key]: host });
      return host;
    }
    say(red(`Cannot log in to ${host} with an SSH key.`));
    say(`Set up key login first, for example: ${bold(`ssh-copy-id ${host}`)}, then try again.`);
  }
}

/** Offers to make a Linux host keep user services running without a login. */
async function linger(host) {
  if (ssh(host, 'uname').out.trim() !== 'Linux') return;
  if (ssh(host, 'loginctl show-user "$USER" --property=Linger').out.includes('Linger=yes')) return;
  say(`${host} must keep its services running when nobody is logged in (loginctl enable-linger).`);
  if (await confirm('Turn that on now? It may ask for your password on that host.'))
    sshTerminal(host, 'sudo loginctl enable-linger "$USER"');
}

const storeToken = () => {
  const result = ssh(env.STORE_HOST, 'cat ~/.config/skyvision-store/store.token');
  if (!result.ok) throw new Error(`Cannot read the store token on ${env.STORE_HOST}: ${result.all.trim()}`);
  return result.out.trim();
};
const putSecret = (folder, name, value) => {
  const result = wrangler(['secret', 'put', name, '--config', 'wrangler.deploy.json'], {
    cwd: path.join(root, 'package', folder),
    input: value,
  });
  if (!result.ok) throw new Error(`Setting ${name} failed:\n${result.all}`);
};

// ---- Steps ------------------------------------------------------------------------------------------------
// Each step has a check that changes nothing (true or a reason it is not done) and a run that does it.

const steps = [
  {
    id: 'cloudflare',
    title: 'Cloudflare account',
    async check() {
      const who = json(wrangler(['whoami', '--json']).out);
      if (!who?.loggedIn) return 'Wrangler is not signed in.';
      if (who.accounts?.length > 1 && !env.CLOUDFLARE_ACCOUNT_ID) return 'Choose one of your Cloudflare accounts.';
      return true;
    },
    async run() {
      say('Wrangler, the Cloudflare command line, signs in through your browser.');
      if (!json(wrangler(['whoami', '--json']).out)?.loggedIn) run(wranglerBin, ['login']);
      const who = json(wrangler(['whoami', '--json']).out);
      if (!who?.loggedIn) throw new Error('Wrangler is still not signed in.');
      if (who.accounts?.length > 1) {
        who.accounts.forEach((a, i) => say(`${i + 1}. ${a.name} (${a.id})`));
        const pick = await ask('Which account', { problem: v => (who.accounts[+v - 1] ? undefined : 'Enter a number.') });
        save({ CLOUDFLARE_ACCOUNT_ID: who.accounts[+pick - 1].id });
      }
    },
  },
  {
    id: 'hosts',
    title: 'Website, API and camera names',
    async check() {
      if (lib.problems.host(env.SITE_HOST ?? '') || lib.problems.host(env.API_HOST ?? '')) return 'No website and API hostnames yet.';
      if (lib.problems.camera(env.CAM_ID ?? '')) return 'No camera ID yet.';
      if (!(env.CAMERAS ?? '').split(',').includes(env.CAM_ID)) return `CAMERAS does not include the camera ${env.CAM_ID}.`;
      return true;
    },
    async run() {
      say('The website and API are two hostnames on a domain in your Cloudflare account.');
      const site = await ask('Website hostname, for example sky.example.com', { initial: env.SITE_HOST, problem: lib.problems.host });
      const apiHost = await ask('API hostname', { initial: env.API_HOST || `api.${site}`, problem: lib.problems.host });
      const cam = await ask('A short ID for the camera', { initial: env.CAM_ID || 'sky01', problem: lib.problems.camera });
      const cameras = [...new Set([...(env.CAMERAS ?? '').split(',').filter(Boolean), cam])].join(',');
      save({ SITE_HOST: site, API_HOST: apiHost, CAM_ID: cam, CAMERAS: cameras });
    },
  },
  {
    id: 'storage',
    title: 'Database and storage buckets',
    async check() {
      const databases = json(wrangler(['d1', 'list', '--json']).out) ?? [];
      if (!databases.some(d => d.name === 'skyvision-catalog')) return 'The skyvision-catalog database does not exist.';
      const buckets = lib.parseBuckets(wrangler(['r2', 'bucket', 'list']).out);
      const missing = ['skyvision-models', 'skyvision-workshop'].filter(b => !buckets.includes(b));
      return missing.length ? `Missing R2 buckets: ${missing.join(', ')}.` : true;
    },
    async run() {
      let databases = json(wrangler(['d1', 'list', '--json']).out) ?? [];
      if (!databases.some(d => d.name === 'skyvision-catalog')) {
        say('Creating the D1 database skyvision-catalog…');
        const made = wrangler(['d1', 'create', 'skyvision-catalog'], { input: '' });
        if (!made.ok) throw new Error(made.all);
        databases = json(wrangler(['d1', 'list', '--json']).out) ?? [];
      }
      save({ D1_DATABASE_ID: databases.find(d => d.name === 'skyvision-catalog').uuid });
      const buckets = lib.parseBuckets(wrangler(['r2', 'bucket', 'list']).out);
      for (const bucket of ['skyvision-models', 'skyvision-workshop'].filter(b => !buckets.includes(b))) {
        say(`Creating the R2 bucket ${bucket}…`);
        const made = wrangler(['r2', 'bucket', 'create', bucket]);
        if (!made.ok) throw new Error(made.all);
      }
    },
  },
  {
    id: 'store',
    title: 'Footage store',
    async check() {
      const services = lib.parseVpcServices(wrangler(['vpc', 'service', 'list']).out);
      if (!env.STORE_SERVICE_ID || !services.some(s => s.id === env.STORE_SERVICE_ID)) return 'No VPC service for the footage store.';
      if (env.STORE_HOST) {
        const code = ssh(env.STORE_HOST, 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8096/o/check').out.trim();
        if (code !== '401') return `The store on ${env.STORE_HOST} is not answering on 127.0.0.1:8096.`;
      }
      return true;
    },
    async run() {
      say('Every recording is kept on one machine with a large disk, the footage store. The Workers');
      say('reach it through a Cloudflare Tunnel, so it needs no open ports. About 43 GB a day at 4 Mbps.');
      const host = await sshHost('SSH host of the store machine, for example me@nas.local', 'STORE_HOST');
      for (;;) {
        const tools = ssh(host, 'PATH=/opt/homebrew/bin:/usr/local/bin:$PATH; for t in python3 cloudflared openssl curl; do command -v $t >/dev/null || echo $t; done');
        const missing = tools.out.split('\n').filter(Boolean);
        if (!missing.length) break;
        say(yellow(`${host} is missing: ${missing.join(', ')}.`));
        if (ssh(host, 'uname').out.trim() === 'Darwin' && (await confirm('Install them with Homebrew now?'))) {
          sshTerminal(host, `PATH=/opt/homebrew/bin:/usr/local/bin:$PATH brew install ${missing.join(' ')}`);
        } else {
          say('Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
          await pause('Press Enter once they are installed.');
        }
      }
      const folder = await ask('Folder for the footage, for example /mnt/footage', { initial: env.STORE_ROOT, problem: lib.problems.folder });
      ssh(host, `mkdir -p '${folder}'`);
      let systemDisk = env.STORE_SYSTEM_DISK === 'yes';
      if (ssh(host, `python3 -c 'import os,sys; sys.exit(0 if os.path.ismount(sys.argv[1]) else 1)' '${folder}'`).ok) systemDisk = false;
      else {
        say(`${folder} is not a separate disk. The store refuses to write to a folder whose disk is missing,`);
        say('so a drive that fails to mount never fills the system disk.');
        systemDisk = await confirm('Keep footage in this folder on the system disk anyway?', false);
        if (!systemDisk) throw new Error(`Mount the footage disk at ${folder}, then run setup again.`);
      }
      save({ STORE_ROOT: folder, STORE_SYSTEM_DISK: systemDisk ? 'yes' : 'no' });

      let tunnelId = env.STORE_TUNNEL_ID;
      if (!tunnelId || !ssh(host, 'test -s ~/.config/skyvision-store/tunnel.token').ok) {
        say('');
        say(bold('Create a tunnel in the Cloudflare dashboard:'));
        say('Networks → Tunnels → Create a tunnel → Cloudflared. Name it openskycam-store and save it.');
        say('It needs no public hostname. On the install page, copy the command: the long token after --token is what you need.');
        openUrl('https://one.dash.cloudflare.com/');
        for (;;) {
          const token = await ask('Tunnel token', { secret: true });
          try {
            tunnelId = lib.parseTunnelToken(token).tunnelId;
            const wrote = ssh(host, 'mkdir -p ~/.config/skyvision-store && umask 077 && cat > ~/.config/skyvision-store/tunnel.token', token.trim());
            if (!wrote.ok) throw new Error(wrote.all);
            break;
          } catch (error) {
            say(red(error.message));
          }
        }
        save({ STORE_TUNNEL_ID: tunnelId });
      }
      await linger(host);
      say('Installing the store and its tunnel…');
      const deployed = run(path.join(root, 'external/store/deploy.sh'), [host, folder, ...(systemDisk ? ['--system-disk'] : [])]);
      if (!deployed.ok) throw new Error('The store install failed; see the output above.');
      const up = await waitFor('the store', 30, () =>
        ssh(host, 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8096/o/check').out.trim() === '401',
      );
      if (!up) throw new Error('The store did not start. Its log: ~/Library/Logs/org.openskycam.store.log (macOS) or journalctl --user-unit=skyvision-store (Linux).');

      let service = lib.parseVpcServices(wrangler(['vpc', 'service', 'list']).out).find(s => s.name === 'skyvision-store');
      if (!service) {
        const made = wrangler(['vpc', 'service', 'create', 'skyvision-store', '--type', 'http', '--tunnel-id', tunnelId, '--ipv4', '127.0.0.1', '--http-port', '8096']);
        if (!made.ok) throw new Error(made.all);
        service = lib.parseVpcServices(wrangler(['vpc', 'service', 'list']).out).find(s => s.name === 'skyvision-store');
      }
      save({ STORE_SERVICE_ID: service.id });
    },
  },
  {
    id: 'access',
    title: 'Sign-in with Cloudflare Access',
    async check() {
      if (lib.problems.aud(env.ACCESS_AUD ?? '')) return 'No Access application audience tag yet.';
      const certs = await http(`${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
      return certs.status === 200 && json(certs.text)?.keys ? true : `${env.ACCESS_TEAM_DOMAIN} is not an Access team domain.`;
    },
    async run() {
      say('Cloudflare Access decides who can open the website. In Zero Trust:');
      say(`1. Access → Applications → Add an application → Self-hosted, for ${bold(env.SITE_HOST)} only.`);
      say('2. Add a policy that allows your email address (and anyone else who should see the camera).');
      say(`3. Do not add ${env.API_HOST}: the API uses keys, not sign-in.`);
      say('4. Save, then copy the Application Audience (AUD) tag from the application\'s Basic information.');
      openUrl('https://one.dash.cloudflare.com/');
      for (;;) {
        const team = lib.teamDomain(await ask('Team domain, shown under Settings → Custom pages or in the sign-in URL', { initial: env.ACCESS_TEAM_DOMAIN, problem: lib.problems.team }));
        const certs = await http(`${team}/cdn-cgi/access/certs`);
        if (certs.status === 200 && json(certs.text)?.keys) {
          save({ ACCESS_TEAM_DOMAIN: team });
          break;
        }
        say(red(`${team} does not answer as an Access team domain.`));
      }
      save({ ACCESS_AUD: await ask('Application Audience (AUD) tag', { initial: env.ACCESS_AUD, problem: lib.problems.aud }) });
      say('');
      say('Scripts call the API with keys, but Cloudflare\'s Browser Integrity Check blocks many of them first.');
      say(`Turn it off for ${env.API_HOST} only: your domain → Rules → Configuration Rules → Create rule,`);
      say(`when Hostname equals ${env.API_HOST}, set Browser Integrity Check to Off.`);
      openUrl('https://dash.cloudflare.com/');
      await pause();
    },
  },
  {
    id: 'website',
    title: 'Website and API Worker',
    async check() {
      if (!env.API_HOST) return 'The website is not deployed yet.';
      const spec = await http(`https://${env.API_HOST}/openapi.json`, { headers: { 'User-Agent': 'Python-urllib/3.12' } });
      if (spec.status === 403 && spec.text.includes('1010')) return 'Browser Integrity Check still blocks scripts on the API host.';
      if (spec.status !== 200) return `https://${env.API_HOST}/openapi.json answers ${spec.status || spec.text}.`;
      const me = await http(`https://${env.API_HOST}/v1/me`);
      return me.status === 401 && json(me.text)?.error ? true : `/v1/me answers ${me.status}, not 401.`;
    },
    async run() {
      say('Applying the database migrations and deploying the website and API…');
      const released = run('npm', ['run', 'release'], { cwd: path.join(root, 'package/dashboard') });
      if (!released.ok) throw new Error('The deploy failed; see the output above.');
      putSecret('dashboard', 'STORE_TOKEN', storeToken());
      say('New hostnames can take a few minutes to get their certificates.');
      await waitFor(`https://${env.API_HOST}`, 300, async () => (await this.check()) === true);
    },
  },
  {
    id: 'ingest',
    title: 'Ingest Worker',
    async check() {
      if (!env.INGEST_URL || !env.INGEST_TOKEN) return 'The ingest Worker is not deployed yet.';
      const status = await http(`${env.INGEST_URL}/v1/status`, { headers: { Authorization: `Bearer ${env.INGEST_TOKEN}` } });
      return [200, 503].includes(status.status) && json(status.text)?.cameras ? true : `${env.INGEST_URL} answers ${status.status || status.text}.`;
    },
    async run() {
      if (!/^[a-f0-9]{64}$/.test(env.INGEST_TOKEN ?? '')) save({ INGEST_TOKEN: crypto.randomBytes(32).toString('hex') });
      say('Deploying the Worker that receives recordings…');
      const deployed = await runShown('npm', ['run', 'deploy'], path.join(root, 'package/worker'));
      if (!deployed.ok) throw new Error('The deploy failed; see the output above.');
      let url = lib.ingestUrl(deployed.out);
      if (!url) {
        say(yellow('The deploy did not print a workers.dev address. Your account may need a workers.dev subdomain:'));
        say('Workers & Pages → Overview → workers.dev subdomain.');
        openUrl('https://dash.cloudflare.com/?to=/:account/workers-and-pages');
        url = await ask('The ingest Worker address, https://skyvision-ingest.<subdomain>.workers.dev', { initial: env.INGEST_URL, problem: v => (/^https:\/\//.test(v) ? undefined : 'Start with https://.') });
      }
      save({ INGEST_URL: url });
      putSecret('worker', 'INGEST_TOKEN', env.INGEST_TOKEN);
      putSecret('worker', 'STORE_TOKEN', storeToken());
      await waitFor('the ingest Worker', 120, async () => (await this.check()) === true);
    },
  },
  {
    id: 'relay',
    title: 'Camera and relay',
    async check() {
      if (!env.INGEST_URL) return 'The ingest Worker is not deployed yet.';
      const status = json((await http(`${env.INGEST_URL}/v1/status`, { headers: { Authorization: `Bearer ${env.INGEST_TOKEN}` } })).text);
      const camera = status?.cameras?.find(c => c.cam === env.CAM_ID) ?? status?.cameras?.[0];
      if (camera?.age_seconds == null) return 'No recording has arrived yet.';
      return camera.age_seconds <= 180 ? true : `The newest recording is ${camera.age_seconds} seconds old.`;
    },
    async run() {
      say('The relay is a small Linux machine near the camera, such as a Raspberry Pi. It copies the');
      say('camera\'s stream into one-minute files without re-encoding and uploads them.');
      const host = await sshHost('SSH host of the relay, for example pi@relay.local', 'RELAY_HOST');
      if (ssh(host, 'uname').out.trim() !== 'Linux') throw new Error('The relay must be a Linux host with systemd.');
      const missing = ssh(host, 'for t in ffmpeg ffprobe curl; do command -v $t >/dev/null || echo $t; done').out.split('\n').filter(Boolean);
      if (missing.length) {
        say(yellow(`${host} is missing: ${missing.join(', ')}.`));
        if (await confirm('Install ffmpeg and curl with apt now? It asks for your password on that host.')) sshTerminal(host, 'sudo apt-get update && sudo apt-get install -y ffmpeg curl');
      }
      await linger(host);
      for (;;) {
        say('');
        say('The camera must stream H.264 or H.265 over RTSP (see docs/requirements.md).');
        const ip = await ask('Camera address', { initial: env.CAMERA_IP_ADDRESS, problem: lib.problems.address });
        const user = await ask('Camera user name', { initial: env.CAMERA_USERNAME || 'admin' });
        const password = await ask('Camera password', { initial: env.CAMERA_PASSWORD, secret: true });
        const port = await ask('RTSP port', { initial: env.CAMERA_RTSP_PORT || '554', problem: lib.problems.port });
        say(dim('Stream paths: Dahua /cam/realmonitor?channel=1&subtype=0 · Hikvision /Streaming/Channels/101 · Tapo /stream1'));
        const streamPath = await ask('RTSP path', { initial: env.CAMERA_RTSP_PATH || '/cam/realmonitor?channel=1&subtype=0', problem: lib.problems.path });
        save({ CAMERA_IP_ADDRESS: ip, CAMERA_USERNAME: user, CAMERA_PASSWORD: password, CAMERA_RTSP_PORT: port, CAMERA_RTSP_PATH: streamPath });
        say(`Checking the stream from ${host}…`);
        const url = `rtsp://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${ip}:${port}${streamPath}`;
        const probe = ssh(host, 'read -r url; timeout 20 ffprobe -v error -rtsp_transport tcp -select_streams v:0 -show_entries stream=codec_name,width,height -of csv=p=0 "$url"', url);
        const [codec, width, height] = probe.out.trim().split('\n').pop().split(',');
        if (probe.ok && ['hevc', 'h264'].includes(codec)) {
          say(green(`The camera streams ${codec === 'hevc' ? 'H.265' : 'H.264'} at ${width}×${height}.`));
          break;
        }
        say(red(probe.ok ? `The camera streams ${codec}; the relay records H.264 or H.265 only.` : `The relay cannot read the stream: ${probe.all.trim().split('\n').pop()}`));
      }
      say('Installing the recorder and uploader…');
      if (!run(path.join(root, 'external/relay/deploy.sh'), [host]).ok) throw new Error('The relay install failed; see the output above.');
      const token = ssh(host, 'umask 077; cat > ~/.config/skyvision/ingest.env && systemctl --user restart skyvision-upload', `INGEST_TOKEN=${env.INGEST_TOKEN}\n`);
      if (!token.ok) throw new Error(token.all);
      say('The first file uploads after a full minute of recording.');
      if (!(await waitFor('the first recording', 240, async () => (await this.check()) === true)))
        throw new Error(`Nothing arrived. On the relay: ssh ${host} journalctl --user-unit=skyvision-upload -n 20`);
    },
  },
  {
    id: 'processor',
    title: 'Processor (optional)',
    optional: true,
    async check() {
      if (!env.OPENSKYCAM_AGENT_KEY || !env.API_HOST) return 'Not set up.';
      const runtimes = json((await api('/v1/workshop/runtimes', env.OPENSKYCAM_AGENT_KEY)).text)?.runtimes ?? [];
      const seen = runtimes.some(r => r.last_seen_at && Date.now() - Date.parse(r.last_seen_at) < 5 * 60 * 1000);
      return seen ? true : 'No processor has checked in during the last 5 minutes.';
    },
    async run() {
      say('The processor runs detection models over your footage for Workshop workflows. It needs a');
      say('macOS or Linux machine with Python 3.11 or later; an Apple or NVIDIA GPU makes it much faster.');
      if (!(await confirm('Set up a processor now?', false))) return 'skipped';
      const site = `https://${env.SITE_HOST}/?view=api`;
      for (;;) {
        if (env.OPENSKYCAM_AGENT_KEY && json((await api('/v1/me', env.OPENSKYCAM_AGENT_KEY)).text)?.scope === 'agent') break;
        say('');
        say(`On the website, open ${bold('API access')} and create a key: Purpose ${bold('Agent')}, every camera.`);
        say('Setup uses it to register the processor; it is saved in .env for your own scripts too.');
        openUrl(site);
        save({ OPENSKYCAM_AGENT_KEY: await ask('Agent key', { secret: true }) });
      }
      const host = await sshHost('SSH host of the processor machine', 'PROCESSOR_HOST');
      const python = ssh(host, 'PATH=/opt/homebrew/bin:/usr/local/bin:$PATH; command -v python3 && python3 -c "import sys; sys.exit(sys.version_info < (3, 11))"');
      if (!python.ok) throw new Error(`${host} needs Python 3.11 or later.`);
      const suggested = ssh(host, 'hostname -s').out.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-');
      const device = await ask('Device name for this machine', { initial: env.PROCESSOR_DEVICE || suggested, problem: lib.problems.device });
      const created = await api('/v1/models/devices', env.OPENSKYCAM_AGENT_KEY, { method: 'POST', body: JSON.stringify({ id: device }) });
      if (![200, 201].includes(created.status)) throw new Error(`Registering ${device} failed: ${created.status} ${created.text}`);
      save({ PROCESSOR_DEVICE: device });
      for (;;) {
        say('');
        say(`Create a second key: Purpose ${bold('Run Workshop jobs')}, device ${bold(device)}, every camera.`);
        openUrl(site);
        const key = await ask('Run Workshop jobs key', { secret: true });
        const me = json((await api('/v1/me', key)).text);
        if (me?.scope === 'workshop:run') {
          ssh(host, 'mkdir -p ~/.config/openskycam && umask 077 && cat > ~/.config/openskycam/workshop.key', key);
          break;
        }
        say(red(me ? `That key's purpose is ${me.scope}.` : 'That key was refused.'));
      }
      const commit = run('git', ['rev-parse', '--short', 'HEAD'], { quiet: true }).out.trim();
      const folder = `openskycam-processor/${commit}`;
      say(`Copying the processor to ~/${folder} and installing its packages (several minutes the first time)…`);
      const archive = spawnSync('git', ['archive', 'HEAD', 'processor/install-workshop.sh', 'processor/requirements.txt', 'processor/skyvision_processor'], { cwd: root });
      if (!ssh(host, `mkdir -p ~/${folder} && tar -x --strip-components=1 -C ~/${folder}`, archive.stdout).ok) throw new Error('Copying the processor failed.');
      const venv = '~/openskycam-processor/.venv';
      if (!sshTerminal(host, `PATH=/opt/homebrew/bin:/usr/local/bin:$PATH; [ -x ${venv}/bin/python ] || python3 -m venv ${venv}; ${venv}/bin/pip install -q -r ~/${folder}/requirements.txt`))
        throw new Error('Installing the processor packages failed.');
      const manifest = json(ssh(host, `cd ~/${folder} && ${venv}/bin/python -m skyvision_processor workshop-manifest --device ${device}`).out);
      if (!manifest?.code_sha256) throw new Error('The processor did not start; run it by hand to see why.');
      const registered = json((await api('/v1/workshop/runtimes', env.OPENSKYCAM_AGENT_KEY, { method: 'POST', body: JSON.stringify(manifest) })).text);
      if (!registered?.id) throw new Error('Registering the processor runtime failed.');
      await linger(host);
      const installed = ssh(host, `cd ~/${folder} && ./install-workshop.sh "$(cd ~ && pwd)/openskycam-processor/.venv/bin/python" "$HOME/.config/openskycam/workshop.key" ${registered.id} https://${env.API_HOST}`);
      if (!installed.ok) throw new Error(installed.all);
      await waitFor('the processor to check in', 90, async () => {
        const runtimes = json((await api('/v1/workshop/runtimes', env.OPENSKYCAM_AGENT_KEY)).text)?.runtimes ?? [];
        return runtimes.some(r => r.id === registered.id && r.last_seen_at);
      });
    },
  },
];

// ---- Main -------------------------------------------------------------------------------------------------

async function main() {
  if (env.CLOUDFLARE_ACCOUNT_ID) process.env.CLOUDFLARE_ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID;
  if (!fs.existsSync(wranglerBin)) throw new Error('Dependencies are missing: run npm install first.');
  console.log(`\n${bold('openskycam setup')}`);
  if (!checkOnly) say(dim('Answers are saved to .env as you go. Stop any time with Ctrl-C and run npm run setup again.'));
  if (only && !steps.some(s => s.id === only)) throw new Error(`Unknown step ${only}. Steps: ${steps.map(s => s.id).join(', ')}.`);
  let failed = false;
  for (const [index, step] of steps.entries()) {
    if (only && step.id !== only) continue;
    console.log(`\n${bold(`${index + 1}/${steps.length} · ${step.title}`)}`);
    const state = await step.check();
    if (state === true && only !== step.id) {
      say(green('✓ Done'));
      continue;
    }
    if (checkOnly) {
      say(`${step.optional ? yellow('–') : red('✗')} ${state}`);
      failed ||= !step.optional;
      continue;
    }
    if (state !== true) say(dim(state));
    if ((await step.run()) === 'skipped') continue;
    const after = await step.check();
    if (after !== true) throw new Error(`${step.title} is not working yet: ${after}`);
    say(green('✓ Done'));
  }
  if (checkOnly) return failed ? 1 : 0;
  if (only) return 0;
  console.log(`\n${bold('openskycam is running.')}`);
  say(`Website: https://${env.SITE_HOST}`);
  say(`API:     https://${env.API_HOST} (keys under API access on the website)`);
  say(`Check everything again at any time with ${bold('npm run setup -- --check')}.`);
  say(`Documentation: https://docs.openskycam.org`);
  return 0;
}

main()
  .then(code => {
    rl.close();
    process.exitCode = code;
  })
  .catch(error => {
    rl.close();
    console.error(`\n  ${red(error.message)}\n  ${dim('Fix that, then run npm run setup again: finished steps are skipped.')}`);
    process.exitCode = 1;
  });
