const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { files } = require('./build-hosting.cjs');
const root = path.resolve(__dirname, '..');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
(async () => {
  let failures = 0;
  for (const file of files) {
    try {
      const response = await fetch(`https://viaglyph-workspace.web.app/${file}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      const matches = response.ok && digest(bytes) === digest(fs.readFileSync(path.join(root, file)));
      console.log(JSON.stringify({ asset: file, status: response.status, matches }));
      if (!matches) failures++;
    } catch (_) { failures++; console.log(JSON.stringify({ asset: file, matches: false, reason: 'transport failure' })); }
  }
  for (const file of ['gas/Code.gs', 'gas-deploy/.clasp.json', '.vercel/project.json', 'scripts/migrate-data.js', 'database.rules.json', 'package.json']) {
    try {
      const response = await fetch(`https://viaglyph-workspace.web.app/${file}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      console.log(JSON.stringify({ excludedAsset: file, status: response.status }));
      await response.body?.cancel();
      if (response.status !== 404) failures++;
    } catch (_) { failures++; console.log(JSON.stringify({ excludedAsset: file, reason: 'transport failure' })); }
  }
  process.exitCode = failures ? 1 : 0;
})();
