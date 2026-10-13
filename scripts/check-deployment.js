#!/usr/bin/env node

/**
 * Minimal black-box verification used after every Firebase deployment.
 * A real user token is deliberately not stored in CI. The script confirms that
 * the endpoint exists, permits the configured browser origin, and fails closed
 * when a request does not contain a Firebase ID token.
 */
const base = (process.env.WORKSPACE_FUNCTIONS_BASE || '').replace(/\/+$/, '');
const origin = process.env.WORKSPACE_HOSTING_ORIGIN || 'https://viaglyph-workspace.web.app';

if (!base) throw new Error('WORKSPACE_FUNCTIONS_BASE is required');

async function request(method, headers = {}) {
  return fetch(`${base}/establishWorkspaceSession`, { method, headers });
}

(async () => {
  const preflight = await request('OPTIONS', {
    Origin: origin,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization,content-type'
  });
  if (preflight.status !== 204) throw new Error(`CORS preflight failed: HTTP ${preflight.status}`);
  const corsOrigin = preflight.headers.get('access-control-allow-origin');
  if (corsOrigin !== origin) throw new Error(`CORS origin mismatch: ${corsOrigin || 'missing'}`);

  const denied = await request('POST', { Origin: origin, 'Content-Type': 'application/json' });
  if (denied.status !== 403) throw new Error(`Unauthenticated API must fail closed: HTTP ${denied.status}`);
  console.log('Workspace deployment health check passed.');
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
