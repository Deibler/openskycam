import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import * as lib from './lib.mjs';

test('setEnv replaces keys in place, keeps comments, and appends new ones', () => {
  const before = '# Camera\nCAM_ID=old\nSITE_HOST = spaced.example.com\n';
  const after = lib.setEnv(before, { CAM_ID: 'sky02', SITE_HOST: 'sky.example.com', API_HOST: 'api.sky.example.com' });
  assert.equal(after, '# Camera\nCAM_ID=sky02\nSITE_HOST=sky.example.com\nAPI_HOST=api.sky.example.com\n');
  assert.deepEqual(lib.parseEnv(after), { CAM_ID: 'sky02', SITE_HOST: 'sky.example.com', API_HOST: 'api.sky.example.com' });
});

test('inline comments and quotes are read as Node reads them', () => {
  const text = "KEY = abc123  # an agent key\nQUOTED='a # b' # note\nDOUBLE=\"x\"\nEMPTY=\n";
  assert.deepEqual(lib.parseEnv(text), { KEY: 'abc123', QUOTED: 'a # b', DOUBLE: 'x', EMPTY: '' });
});

test('values with shell characters read back the same in bash and in parseEnv', () => {
  const values = { PATH_VALUE: '/cam/realmonitor?channel=1&subtype=0', PASSWORD: `it's $ecret "x" ~me` };
  const text = lib.setEnv('', values);
  assert.deepEqual(lib.parseEnv(text), values);
  const script = `${text}printf '%s\\n' "$PATH_VALUE" "$PASSWORD"`;
  assert.equal(execFileSync('bash', ['-c', script], { encoding: 'utf8' }), `${values.PATH_VALUE}\n${values.PASSWORD}\n`);
});

test('plain values that Node needs stay unquoted', () => {
  assert.equal(lib.quote('https://team.cloudflareaccess.com'), 'https://team.cloudflareaccess.com');
  assert.equal(lib.quote('4f3c2b1a-0000-4000-8000-00000000abcd'), '4f3c2b1a-0000-4000-8000-00000000abcd');
  assert.equal(lib.quote('~/footage'), `'~/footage'`);
});

test('tunnel tokens give their tunnel ID, and other strings are refused', () => {
  const token = Buffer.from(
    JSON.stringify({ a: 'account', t: '9d8e7f60-1111-4222-8333-444455556666', s: 'secret' }),
  ).toString('base64');
  assert.deepEqual(lib.parseTunnelToken(token), { accountId: 'account', tunnelId: '9d8e7f60-1111-4222-8333-444455556666' });
  assert.throws(() => lib.parseTunnelToken('cloudflared service install abc'), /not a tunnel token/);
  assert.throws(() => lib.parseTunnelToken(Buffer.from('{"a":"x"}').toString('base64')), /not a tunnel token/);
});

test('wrangler output parsers read real output', () => {
  const buckets = '\nname:           skyvision-models\ncreation_date:  2026-09-23T20:15:45.562Z\n\nname:           skyvision-workshop\n';
  assert.deepEqual(lib.parseBuckets(buckets), ['skyvision-models', 'skyvision-workshop']);
  const table =
    '│ id                                   │ name            │ type │\n' +
    '│ 4f3c2b1a-0000-4000-8000-00000000abcd │ skyvision-store │ http │\n';
  assert.deepEqual(lib.parseVpcServices(table), [{ id: '4f3c2b1a-0000-4000-8000-00000000abcd', name: 'skyvision-store' }]);
  assert.equal(
    lib.ingestUrl('Deployed skyvision-ingest triggers\n  https://skyvision-ingest.me-123.workers.dev\n'),
    'https://skyvision-ingest.me-123.workers.dev',
  );
  assert.equal(lib.ingestUrl('No workers.dev subdomain'), undefined);
});

test('team domains are normalized, and bad input is reported', () => {
  for (const v of ['myteam', 'myteam.cloudflareaccess.com', 'https://MyTeam.cloudflareaccess.com/'])
    assert.equal(lib.teamDomain(v), 'https://myteam.cloudflareaccess.com');
  assert.equal(lib.teamDomain('my team'), undefined);
  assert.equal(lib.problems.host('sky.example.com'), undefined);
  assert.ok(lib.problems.host('https://sky.example.com'));
  assert.ok(lib.problems.aud('abc'));
  assert.equal(lib.problems.aud('a'.repeat(64)), undefined);
  assert.ok(lib.problems.camera('Sky 01'));
  assert.ok(lib.problems.folder('footage'));
});

test('camera stream URLs and their passwords are removed from error text', () => {
  const url = 'rtsp://admin:s3cret%40x@192.168.1.20:554/stream1';
  assert.equal(lib.redactUrl(`${url}: Connection refused`, url), '<camera stream>: Connection refused');
  assert.equal(lib.redactUrl('rtsp://admin:other@10.1.1.1/x: 401 Unauthorized', url), 'rtsp://10.1.1.1/x: 401 Unauthorized');
});
