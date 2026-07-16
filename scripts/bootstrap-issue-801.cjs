const fs = require('node:fs');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

if (fs.existsSync('server/modules/foods/legacyDeletion.ts')) {
  process.exit(0);
}

const payloadPath = 'scripts/apply-issue-801.cjs.gz.b64';
if (!fs.existsSync(payloadPath)) {
  throw new Error('Issue 801 patch payload was not found.');
}

const compressed = Buffer.from(fs.readFileSync(payloadPath, 'utf8').trim(), 'base64');
const scriptPath = '/tmp/apply-issue-801.cjs';
fs.writeFileSync(scriptPath, zlib.gunzipSync(compressed));

const result = spawnSync(process.execPath, [scriptPath], { stdio: 'inherit' });
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
