import { env, exports } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { authenticate } from '../src/service/accessSharedService';
import { accessToken, get } from './helpers';

describe('Cloudflare Access check', () => {
  it('serves the dashboard to a signed-in viewer', async () => {
    const response = await get('/');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(await response.text()).toContain('<title>openskycam</title>');
  });

  it("returns the viewer's email from the token", async () => {
    const response = await get('/api/overview', { token: await accessToken({ email: 'someone@example.com' }) });

    expect(await response.json()).toMatchObject({ viewer: { email: 'someone@example.com' } });
  });

  it('keeps the content security policy, except for local live reload', async () => {
    const deployed = await get('/');
    const local = await exports.default.fetch(new Request('http://localhost:8787/'));

    expect(deployed.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
    expect(local.status).toBe(200);
    expect(local.headers.get('Content-Security-Policy')).toBeNull();
  });

  it('accepts the local development viewer on localhost only', async () => {
    const local = await exports.default.fetch(new Request('http://localhost:8787/api/overview'));

    expect(local.status).toBe(200);
    expect(await local.json()).toMatchObject({ viewer: { email: 'local-dev@example.com' } });
  });

  it.each([
    ['no token', async () => null],
    ['a token for another Access application', () => accessToken({ audience: 'other-app' })],
    ['a token from another Access team', () => accessToken({ issuer: 'https://other-team.cloudflareaccess.com' })],
    ['an expired token', () => accessToken({ expiresIn: '-1m' })],
    ['a token signed with an unpublished key', () => accessToken({ foreignKey: true })],
    ['a malformed token', async () => 'not-a-jwt'],
  ])('refuses %s, for pages, static files and the API alike', async (_case, makeToken) => {
    const token = await makeToken();

    for (const path of ['/', '/theme.js', '/api/overview', '/api/availability']) {
      const response = await get(path, { token });
      expect(response.status, path).toBe(403);
    }
  });

  it("answers 503, not 403, when Access's public keys cannot be fetched", async () => {
    const team = 'https://keys-down.cloudflareaccess.com';
    const token = await accessToken({ issuer: team });
    vi.mocked(fetch).mockImplementationOnce(async () => {
      throw new TypeError('network connection lost');
    });

    await expect(authenticate(token, 'openskycam.test', { ...env, ACCESS_TEAM_DOMAIN: team })).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
});
