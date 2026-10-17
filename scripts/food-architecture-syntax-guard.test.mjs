import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const script = 'scripts/food-architecture-syntax-guard.mjs';
function check(source) {
  const dir = mkdtempSync(join(tmpdir(),'food-architecture-syntax-'));
  try {
    const file = join(dir, 'architecture.ts');
    writeFileSync(file, source);
    return spawnSync(process.execPath,[script,file],{encoding:'utf8'});
  } finally {rmSync(dir,{recursive:true,force:true});}
}
test('accepts valid detector TypeScript',()=>{
  const result=check('function parseFood(input: string): number { return input.length; }');
  assert.equal(result.status,0,result.stderr);
});
test('catches stray closing brace before full Vitest shards',()=>{
  const result=check('function parseFood(input: string): number { return input.length; } }');
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Declaration or statement expected|Unexpected token/);
});
