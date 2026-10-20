/** Fast fail-closed syntax preflight for architecture detector files that are
 * excluded from the root TypeScript project by tsconfig.json. */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const input = process.argv.slice(2);
const paths = input.length ? input : [
  ...readdirSync('scripts').filter(name =>
    /^food-(?:architecture|intelligence-architecture)(?:[-.].+)?\.tsx?$/.test(name))
    .map(name => path.join('scripts', name)),
  'server/modules/foodIntelligenceV2/foodArchitectureSemanticBoundaries.test.ts',
].filter(existsSync);
if (!paths.length) { console.error('No architecture source files to verify'); process.exit(1); }
let failures = 0;
for (const file of paths) {
  const source = readFileSync(file, 'utf8');
  const scriptKind = file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  for (const diagnostic of tree.parseDiagnostics) {
    const loc = tree.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    console.error(`${file}:${loc.line+1}:${loc.character+1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
    failures++;
  }
}
if (failures) {
  console.error(`Architecture source syntax check FAILED (${failures} errors across ${paths.length} files)`);
  process.exitCode = 1;
} else console.log(`Architecture source syntax check passed (${paths.length} files)`);
