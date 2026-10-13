// Read-only incident checks. Credential values and file contents never appear
// in the report. Google credentials stay in process memory / HTTP headers.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = ['gas/Code.gs', 'gas-deploy/コード.js', 'gas-deploy/.clasp.json', 'gas-deploy/appsscript.json', '.vercel/project.json', 'scripts/migrate-data.js', 'update_test.py', 'test_canvas.js'];
const patterns = [
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{16,}/g],
  ['GitHub token', /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g],
  ['Google access token', /ya29\.[A-Za-z0-9._-]{20,}/g],
  ['Private key', /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g],
  ['Slack webhook', /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/g],
  ['Discord webhook', /https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{20,}/g]
];
const findings = [];
for (const file of files) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) continue;
  const content = fs.readFileSync(absolute, 'utf8');
  for (const [category, regex] of patterns) {
    const count = [...content.matchAll(regex)].length;
    if (count) findings.push({ file, category, count });
  }
}
console.log(JSON.stringify({ localCredentialPatternFindings: findings, limitation: 'Pattern checks do not prove absence of arbitrary passwords or confidential data.' }));

(async () => {
  let token;
  try {
    token = execFileSync('cmd.exe', ['/d', '/c', 'gcloud auth print-access-token --account=siteiiryoubugaihinn2@gmail.com'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).trim();
    const get = async (url) => {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': 'viaglyph-workspace' }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        console.log(JSON.stringify({ apiFailure: { httpStatus: response.status, status: errorBody.error?.status, reasons: (errorBody.error?.details || []).map(item => item.reason).filter(Boolean) } }));
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    };
    let pageToken;
    const releases = [];
    do {
      const data = await get(`https://firebasehosting.googleapis.com/v1beta1/sites/viaglyph-workspace/releases?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
      for (const item of data.releases || []) releases.push({ name: item.name, releaseTime: item.releaseTime, type: item.type, version: item.version?.name, status: item.version?.status });
      pageToken = data.nextPageToken;
    } while (pageToken);
    console.log(JSON.stringify({ releases }));
    const expectedExposedVersions = new Set(['d98f390a27ac72c5', 'ada5996664cdc66d', '19c12597c07ccd54', '095e4d923ed0a09f', '953faadeb7ea3004']);
    const newest = releases.filter(r => r.version).sort((a, b) => b.releaseTime.localeCompare(a.releaseTime))[0]?.version;
    const seen = new Set();
    for (const release of releases) {
      if (!release.version || seen.has(release.version)) continue;
      seen.add(release.version);
      if (release.status === 'DELETED') {
        console.log(JSON.stringify({ version: release.version, status: 'DELETED' }));
        continue;
      }
      let next;
      const paths = [];
      do {
        const data = await get(`https://firebasehosting.googleapis.com/v1beta1/${release.version}/files?pageSize=100${next ? `&pageToken=${encodeURIComponent(next)}` : ''}`);
        paths.push(...(data.files || []).map(file => file.path));
        next = data.nextPageToken;
      } while (next);
      console.log(JSON.stringify({ version: release.version, fileCount: paths.length, manifestPaths: paths, developmentPaths: paths.filter(p => /\/(?:gas|gas-deploy|scripts|tests|\.vercel)\//.test(p)) }));
      if (process.argv.includes('--purge-exposed-versions') && expectedExposedVersions.has(release.version.split('/').pop())) {
        if (release.version === newest || !paths.includes('/gas/Code.gs')) throw new Error('Cleanup target does not match verified exposure');
        const response = await fetch(`https://firebasehosting.googleapis.com/v1beta1/${release.version}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': 'viaglyph-workspace' }, signal: AbortSignal.timeout(30000)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const verify = await get(`https://firebasehosting.googleapis.com/v1beta1/${release.version}`);
        console.log(JSON.stringify({ removedVersion: release.version, status: verify.status }));
        if (verify.status !== 'DELETED') throw new Error('Version deletion not confirmed');
      }
    }
    let logPage;
    let logCount = 0;
    const byStatus = {};
    do {
      const response = await fetch('https://logging.googleapis.com/v2/entries:list', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': 'viaglyph-workspace', 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceNames: ['projects/viaglyph-workspace'],
          filter: 'resource.type="firebase_domain" AND timestamp>="2026-09-20T14:18:00Z" AND timestamp<="2026-10-13T01:50:00Z" AND (httpRequest.requestUrl:"/gas/" OR httpRequest.requestUrl:"/gas-deploy/" OR httpRequest.requestUrl:"/.vercel/" OR httpRequest.requestUrl:"/scripts/")',
          pageSize: 1000, pageToken: logPage }), signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) { console.log(JSON.stringify({ accessLogCheck: 'unavailable', httpStatus: response.status })); break; }
      const data = await response.json();
      for (const entry of data.entries || []) {
        logCount++;
        const status = entry.httpRequest?.status || 'unknown';
        byStatus[status] = (byStatus[status] || 0) + 1;
      }
      logPage = data.nextPageToken;
      if (!logPage) console.log(JSON.stringify({ accessLogCheck: 'queried', matchingEntries: logCount, byStatus,
        limitation: 'No matching logs does not prove no access; exports may not have been enabled or retention may exclude older requests.' }));
    } while (logPage);
  } catch (error) {
    // Never print child-process error objects, stdout, stderr, or token values.
    console.error(`Hosting history check unavailable (${String(error.message).match(/HTTP \d+/)?.[0] || 'authentication or transport failure'}).`);
    process.exitCode = 1;
  } finally { token = undefined; }
})();
