/** Issue #1300 F72/F73 — scalar reads and transitive RequestInit aliases.
 * Independently observable positive/negative controls for the actual detector
 * and the production new-violation enforcement, not a mocked fetch or parser. */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

const decision = (call = "fetch('/foods.json',opts)") =>
  `export async function check(foodName:string){const rows=await (await ${call}).json();return rows.some((r:any)=>r.name===foodName)}`;

type Probe = readonly [id: string, code: string, shouldBlock: boolean];
const probes: Probe[] = [
  // F72: pure scalar reads preserve a proven GET catalog; the same source
  // without the read must have the same verdict (metamorphic invariant).
  ["F72-simple-GET-control", `const opts={method:'GET'};${decision()}`, true],
  ["F72-property-read", `const opts={method:'GET'};const method=opts.method;${decision()}`, true],
  ["F72-bracket-read", `const opts={method:'GET'};const method=opts['method'];${decision()}`, true],
  ["F72-primitive-nested-read", `const opts={method:'GET',headers:{Accept:'application/json'}};const mime=opts.headers.Accept;${decision()}`, true],
  ["F72-scalar-destructure", `const opts={method:'GET'};const {method}=opts;${decision()}`, true],
  ["F72-scalar-destructure-rename", `const opts={method:'GET'};const {method:verb}=opts;${decision()}`, true],
  ["F72-read-before-native-reuse", `const opts={method:'GET'};const method=opts.method;export async function check(foodName:string){const first=await fetch('/foods.json',opts);await window.fetch('/foods.json',opts);const rows=await first.json();return rows.some((r:any)=>r.name===foodName)}`, true],
  ["F72-wrapper-read", `const opts={method:'GET'};const method=opts.method;const load=(url:string)=>window.fetch(url,opts);${decision("load('/foods.json')")}`, true],
  ["F72-unrelated-property", `const opts={method:'GET'};const other={method:'POST'};const unused=other.method;${decision()}`, true],
  ["F72-scalar-as-call-argument", `const opts={method:'GET'};audit(opts.method);${decision()}`, true],
  ["F72-scalar-method-call", `const opts={method:'GET'};const normalized=opts.method.toUpperCase();${decision()}`, true],
  ["F72-scalar-in-object", `const opts={method:'GET'};const details={verb:opts.method};${decision()}`, true],
  ["F72-read-then-write", `const opts={method:'GET'};const method=opts.method;opts.method='POST';${decision()}`, false],
  ["F72-readable-non-primitive-escape", `const opts={headers:{Accept:'application/json'}};const exposed=opts.headers;exposed.Accept='text/plain';${decision()}`, false],
  // F73: sharing the RequestInit identity through an array/object/construction
  // remains safe until a path mutates or exposes it to an unknown consumer.
  ["F73-benign-array-container", `const opts={method:'GET'};const holder=[opts];${decision()}`, true],
  ["F73-benign-object-container", `const opts={method:'GET'};const holder={opts};${decision()}`, true],
  ["F73-benign-nested-container", `const opts={method:'GET'};const holder={items:[opts]};${decision()}`, true],
  ["F73-benign-constructor-unrelated", `const opts={method:'GET'};class Whatever{constructor(x:string){}}new Whatever('x');${decision()}`, true],
  ["F73-benign-array-unrelated", `const opts={method:'GET'};const arr=['hi'];arr[0]='bye';${decision()}`, true],
  ["F73-array-index-mutates", `const opts={method:'GET'};const holder=[opts];holder[0].method='POST';${decision()}`, false],
  ["F73-unrelated-array-element-mutates", `const opts={method:'GET'};const holder=[opts,{method:'POST'}];holder[1].method='GET';${decision()}`, true],
  ["F73-unrelated-array-alias-mutates", `const opts={method:'GET'};const holder=[opts,{method:'POST'}];const other=holder[1];other.method='GET';${decision()}`, true],
  ["F73-unrelated-object-property-mutates", `const opts={method:'GET'};const holder={options:opts,unrelated:{method:'POST'}};holder.unrelated.method='GET';${decision()}`, true],
  ["F73-array-alias-mutates", `const opts={method:'GET'};const holder=[opts];const alias=holder[0];alias.method='POST';${decision()}`, false],
  ["F73-array-destructure-mutates", `const opts={method:'GET'};const [alias]=[opts];alias.method='POST';${decision()}`, false],
  ["F73-nested-array-mutates", `const opts={method:'GET'};const holder={items:[opts]};holder.items[0].method='POST';${decision()}`, false],
  ["F73-nested-object-mutates", `const opts={method:'GET'};const holder={opts};holder.opts.method='POST';${decision()}`, false],
  ["F73-array-spread-mutates", `const opts={method:'GET'};const holder=[...([opts])];holder[0].method='POST';${decision()}`, false],
  ["F73-unknown-call-with-array", `const opts={method:'GET'};const holder=[opts];configure(holder);${decision()}`, false],
  ["F73-unknown-call-with-options", `const opts={method:'GET'};configure(opts);${decision()}`, false],
  ["F73-new-mutator", `const opts={method:'GET'};class Mutator{constructor(o:any){o.method='POST'}}new Mutator(opts);${decision()}`, false],
  ["F73-new-second-arg", `const opts={method:'GET'};class Mutator{constructor(_n:any,o:any){o.method='POST'}}new Mutator(1,opts);${decision()}`, false],
  ["F73-new-array-payload", `const opts={method:'GET'};class Mutator{constructor(o:any){o[0].method='POST'}}new Mutator([opts]);${decision()}`, false],
  ["F73-native-wrapper-constructor", `const opts={method:'GET'};class Mutator{constructor(o:any){o.method='POST'}}const load=(url:string)=>window.fetch(url,opts);new Mutator(opts);${decision("load('/foods.json')")}`, false],
  ["F73-mutated-through-object-alias", `const opts={method:'GET'};const holder={options:opts};holder.options.method='POST';${decision()}`, false],
  ["F73-direct-write-control", `const opts={method:'GET'};opts.method='POST';${decision()}`, false],
  ["F73-object-assign-control", `const opts={method:'GET'};Object.assign(opts,{method:'POST'});${decision()}`, false],
  ["F73-shadowed-local", `const opts={method:'GET'};function unrelated(){const opts={method:'POST'};opts.method='GET'}${decision()}`, true],
  ["F73-non-food-exercise", `const opts={method:'GET'};export async function exercise(foodName:string){const rows=await(await fetch('/foods.json',opts)).json();return rows.some((r:any)=>r.name===foodName)}`, false],
  ["F73-display-only", `const opts={method:'GET'};export async function view(){const rows=await(await fetch('/foods.json',opts)).json();return rows.length}`, false],
];

describe("AUD1300 F72/F73 — static GET provenance and alias effects", () => {
  for (const [id, code, shouldBlock] of probes) it(id, () => {
    const files: FoodArchitectureFile[] = [
      { path: "client/public/foods.json", content: '[{"name":"arroz","calories":130}]' },
      { path: "client/src/services/catalog.ts", content: code },
    ];
    const source = ts.createSourceFile(files[1].path, code, ts.ScriptTarget.Latest, true);
    expect(source.parseDiagnostics, id).toHaveLength(0);
    const candidates = findFoodStaticCandidates(files);
    const jsonFindings = candidates.filter(f => f.file === "client/public/foods.json");
    const gate = evaluateFoodArchitectureGate(candidates, [], [], new Date("2026-10-19T12:00:00Z"));
    expect(jsonFindings.some(f => f.ruleId === "17"), id).toBe(shouldBlock);
    expect(jsonFindings.some(f => f.ruleId === "5"), id).toBe(shouldBlock);
    // The assertion covers catalog provenance specifically. Independent
    // candidates in the consumer module are not evidence of the JSON source.
    expect(gate.errors.some(error => error.startsWith("New food architecture violation") &&
      error.includes("client/public/foods.json")), id).toBe(shouldBlock);
  });
});
