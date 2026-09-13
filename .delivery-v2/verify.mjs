#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const lock = JSON.parse(readFileSync(resolve(root, 'lock.json'), 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const stableJson = (value) => JSON.stringify(stable(value), null, 2) + '\n';

const errors = [];
for (const [path, expected] of Object.entries(lock.files || {})) {
  const actual = sha256(readFileSync(resolve(root, path), 'utf8'));
  if (actual !== expected) errors.push(path + ': expected ' + expected + ', got ' + actual);
}
const packageIdentity = {
  schemaVersion: lock.schemaVersion,
  source: lock.source,
  canonicalClassifierFingerprint: lock.canonicalClassifierFingerprint,
  target: lock.target,
  files: lock.files
};
const fingerprint = sha256(stableJson(packageIdentity));
if (fingerprint !== lock.packageFingerprint) errors.push('packageFingerprint mismatch');
if (errors.length) {
  console.error('Delivery V2 classifier package drift detected');
  for (const error of errors) console.error('- ' + error);
  process.exitCode = 1;
} else {
  console.log('Delivery V2 classifier package: VALID');
  console.log('Source: ' + lock.source.repository + '@' + lock.source.commit);
  console.log('Fingerprint: ' + lock.packageFingerprint);
}
