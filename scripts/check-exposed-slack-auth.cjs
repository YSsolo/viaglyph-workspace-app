const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const candidates = new Map();
for (const file of ['gas/Code.gs', 'gas-deploy/コード.js']) {
  const filename = path.join(root, file);
  if (!fs.existsSync(filename)) continue;
  for (const [token] of fs.readFileSync(filename, 'utf8').matchAll(/xox[baprs]-[A-Za-z0-9-]{16,}/g)) {
    candidates.set(token, [...(candidates.get(token) || []), file]);
  }
}
(async () => {
  const revoke = process.argv.includes('--revoke-exposed');
  for (const [token, files] of candidates) {
    try {
      const response = await fetch('https://slack.com/api/auth.test', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000)
      });
      const result = await response.json();
      const reason = ['invalid_auth', 'token_revoked', 'account_inactive'].includes(result.error) ? result.error : result.ok ? null : 'unconfirmed';
      console.log(JSON.stringify({ files, valid: result.ok === true, reason }));
      if (process.argv.includes('--scrub-revoked') && !result.ok && ['invalid_auth', 'token_revoked', 'account_inactive'].includes(result.error)) {
        for (const file of [...new Set([...files, 'test_canvas.js'])]) {
          const filename = path.join(root, file);
          if (!fs.existsSync(filename)) continue;
          const original = fs.readFileSync(filename, 'utf8');
          if (!original.includes(token)) continue;
          // Mechanical secret removal after independently verifying revocation.
          fs.writeFileSync(filename, original.split(token).join('REVOKED_SLACK_TOKEN_USE_SERVER_SECRET'), 'utf8');
          console.log(JSON.stringify({ scrubbedFile: file }));
        }
      }
      if (revoke && result.ok) {
        const revokedResponse = await fetch('https://slack.com/api/auth.revoke', {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ test: false }), signal: AbortSignal.timeout(20000)
        });
        const revoked = await revokedResponse.json();
        console.log(JSON.stringify({ files, revoked: revoked.ok === true && revoked.revoked === true }));
        const verify = await fetch('https://slack.com/api/auth.test', {
          method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000)
        });
        const after = await verify.json();
        console.log(JSON.stringify({ files, validAfterRevocation: after.ok === true,
          reason: ['invalid_auth', 'token_revoked', 'account_inactive'].includes(after.error) ? after.error : 'unconfirmed' }));
        if (!revoked.ok || after.ok) process.exitCode = 1;
      }
    } catch (_) { console.log(JSON.stringify({ files, valid: null, reason: 'transport failure' })); }
  }
})();
