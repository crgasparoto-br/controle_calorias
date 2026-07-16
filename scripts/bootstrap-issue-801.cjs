const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

if (fs.existsSync('server/modules/foods/legacyDeletion.ts')) {
  process.exit(0);
}

const payloadDir = 'scripts/issue-801-payload';
if (!fs.existsSync(payloadDir)) {
  throw new Error('Issue 801 patch payload directory was not found.');
}

const encoded = fs.readdirSync(payloadDir)
  .sort()
  .map(fileName => fs.readFileSync(path.join(payloadDir, fileName), 'utf8').trim())
  .join('');
const compressed = Buffer.from(encoded, 'base64');
const scriptPath = '/tmp/apply-issue-801.cjs';
fs.writeFileSync(scriptPath, zlib.gunzipSync(compressed));

const result = spawnSync(process.execPath, [scriptPath], { stdio: 'inherit' });
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
