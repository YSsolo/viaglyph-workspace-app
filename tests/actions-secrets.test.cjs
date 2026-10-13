const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Actions references only user-creatable Secret names and maps owner PATs to server environment', () => {
  const directory = path.resolve(__dirname, '../.github/workflows');
  for (const file of fs.readdirSync(directory).filter(name => /\.ya?ml$/.test(name))) {
    const source = fs.readFileSync(path.join(directory, file), 'utf8');
    for (const [, name] of source.matchAll(/secrets\.([A-Za-z_][A-Za-z_0-9]*)/g)) {
      assert.equal(name.toUpperCase().startsWith('GITHUB_'), false,
        `${file}: GitHub reserves the GITHUB_ Secret prefix`);
    }
  }
  const worker = fs.readFileSync(path.join(directory, 'workspace-sync.yml'), 'utf8');
  for (const owner of ['YSSOLO', 'GANDT', 'SHOTA656']) {
    assert.ok(worker.includes(`GITHUB_TOKEN_${owner}: \${{ secrets.WORKSPACE_GH_PAT_${owner} }}`));
  }
});
