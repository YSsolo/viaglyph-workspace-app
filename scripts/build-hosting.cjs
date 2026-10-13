const fs = require('node:fs');
const path = require('node:path');
const files = ['index.html', 'api.js', 'store.js', 'views.js', 'canvas.js', 'pm.js', 'runtime-config.js', 'style.css', 'canvas.css', 'pm.css'];
function buildHosting(root) {
const output = path.join(root, 'hosting-public');
fs.mkdirSync(output, { recursive: true });
if (!fs.lstatSync(output).isDirectory() || fs.lstatSync(output).isSymbolicLink()) throw new Error('Hosting output must be a local directory');
// Reject unexpected output instead of accidentally publishing it. Never copy
// directories, development metadata, credentials, or arbitrary repository files.
for (const name of fs.readdirSync(output)) {
  if (!files.includes(name)) throw new Error(`Unexpected Hosting output: ${name}`);
}
for (const name of files) {
  const source = path.join(root, name);
  if (!fs.lstatSync(source).isFile()) throw new Error(`Application asset must be a regular file: ${name}`);
  const content = fs.readFileSync(source, 'utf8');
  if (/xox[baprs]-[A-Za-z0-9-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|ya29\.[A-Za-z0-9._-]{20,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}|https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{20,}/.test(content)) {
    throw new Error(`Credential-like content detected in application asset: ${name}`);
  }
}
for (const name of files) {
  const source = path.join(root, name);
  fs.copyFileSync(source, path.join(output, name));
}
console.log(`Hosting build: ${files.length} explicitly allowed application assets.`);
return output;
}
module.exports = { buildHosting, files };
if (require.main === module) buildHosting(path.resolve(__dirname, '..'));
