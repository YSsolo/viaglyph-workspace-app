const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('the installed server SDK constructs and parses WIF credentials without network or real credentials', () => {
  const source = `
    require('node:http').request = require('node:https').request = () => { throw new Error('NETWORK_FORBIDDEN'); };
    global.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };
    const admin = require('./functions/node_modules/firebase-admin');
    (async () => {
      try {
        const credential = admin.credential.applicationDefault();
        const client = await credential.googleAuth.getClient();
        if (client.constructor.name !== 'IdentityPoolClient') throw new Error('WIF_CLIENT_REQUIRED');
        const app = admin.initializeApp({ credential, projectId: 'demo-viaglyph-wif-test' }, 'synthetic-wif-test');
        await app.delete();
        console.log('WIF_CONSTRUCTOR_OK');
      } catch (error) {
        console.error(error.code === 'app/invalid-credential' ? error.code : 'CREDENTIAL_CONSTRUCTION_FAILED');
        process.exitCode = 1;
      }
    })();
  `;
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 10000,
    env: { SystemRoot: process.env.SystemRoot || '',
      GOOGLE_CLOUD_PROJECT: 'demo-viaglyph-wif-test',
      GOOGLE_APPLICATION_CREDENTIALS: path.resolve(__dirname, 'fixtures/synthetic-wif.json') }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'WIF_CONSTRUCTOR_OK');
});

test('the actual Actions entrypoint closes the loaded worker without a root-level Admin SDK dependency', () => {
  const source = `
    const worker = {
      db: { ref: () => ({ get: async () => ({ val: () => ({}) }), update: async () => {} }) },
      shutdown: async () => { console.log('WORKER_CLOSED'); }
    };
    const functionsPath = require.resolve('./functions');
    require.cache[functionsPath] = { id: functionsPath, filename: functionsPath, loaded: true, exports: { workspaceWorker: worker } };
    require('./scripts/actions-sync.cjs');
  `;
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 10000,
    env: { SystemRoot: process.env.SystemRoot || '', WORKSPACE_SEND_DIGEST: 'false' }
  });
  assert.equal(result.status, 0, 'The worker must exit cleanly after reconciliation');
  assert.equal(result.stdout.trim(), 'WORKER_CLOSED');
});
