const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = ['index.html', 'api.js', 'store.js', 'views.js', 'canvas.js', 'pm.js', 'runtime-config.js', 'style.css', 'canvas.css', 'pm.css'];
const output = path.join(root, 'hosting-public');
fs.mkdirSync(output, { recursive: true });
// Reject unexpected output instead of accidentally publishing it. Never copy
// directories, development metadata, credentials, or arbitrary repository files.
for (const name of fs.readdirSync(output)) {
  if (!files.includes(name)) throw new Error(`Unexpected Hosting output: ${name}`);
}
for (const name of files) {
  const source = path.join(root, name);
  if (!fs.statSync(source).isFile()) throw new Error(`Missing application asset: ${name}`);
  fs.copyFileSync(source, path.join(output, name));
}
console.log(`Hosting build: ${files.length} explicitly allowed application assets.`);
