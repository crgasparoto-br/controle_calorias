import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./merge-vitest-junit.py", import.meta.url));

function probe(shards, setup) {
  const work = mkdtempSync(join(tmpdir(), "solverit-junit-"));
  const directory = join(work, "shards");
  mkdirSync(directory);
  for (const [index, xml] of shards.entries()) {
    if (xml !== null) writeFileSync(join(directory, "shard-" + (index + 1) + ".xml"), xml);
  }
  const configured = setup?.({ work, directory, output: join(work, "combined.xml") });
  const output = typeof configured === "string" ? configured : configured?.output ?? join(work, "combined.xml");
  const result = spawnSync("python3", [script, "--dir", directory, "--out", output, "--shards", "2"], { encoding: "utf8" });
  const xml = result.status === 0 ? readFileSync(output, "utf8") : "";
  const effects = typeof configured === "object" ? configured.inspect?.() : undefined;
  rmSync(work, { recursive: true, force: true });
  return { ...result, xml, effects };
}

const xml = (file, testName) => '<testsuites><testsuite name="' + file + '" tests="1"><testcase classname="' + file + '" name="' + testName + '" time="0.01" /></testsuite></testsuites>';

test("consolidates two real JUnit shards preserving identities", () => {
  const result = probe([xml("a.test.ts", "pass A"), xml("b.test.ts", "pass B")]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.xml, /tests="2"/);
  assert.match(result.xml, /pass A/);
  assert.match(result.xml, /pass B/);
});

test("rejects missing shard rather than inventing a pass", () => {
  const result = probe([xml("a.test.ts", "pass A"), null]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing or unsafe exact-run JUnit shard/);
});

test("rejects duplicate executed test identity", () => {
  const result = probe([xml("a.test.ts", "same"), xml("a.test.ts", "same")]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /duplicate test/);
});

test("rejects failing test and invalid XML", () => {
  const failed = probe([xml("a.test.ts", "pass A"), '<testsuite><testcase classname="b" name="bad"><failure message="x" /></testcase></testsuite>']);
  assert.equal(failed.status, 2);
  assert.match(failed.stderr, /failing or errored/);
  const broken = probe([xml("a.test.ts", "pass A"), '<testsuites><testsuite>']);
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /invalid JUnit XML/);
});

test("retains skipped cases in a shard with a real pass", () => {
  const second = '<testsuite tests="2" skipped="1"><testcase classname="b.test.ts" name="skip B"><skipped /></testcase>' +
    '<testcase classname="b.test.ts" name="pass B" /></testsuite>';
  const result = probe([xml("a.test.ts", "pass A"), second]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.xml, /skipped="1"/);
  assert.match(result.xml, /skip B/);
  assert.match(result.xml, /pass B/);
});

test("rejects contradictory JUnit aggregate counts rather than trusting metadata", () => {
  const result = probe([xml("a.test.ts", "pass A"), '<testsuite tests="1" failures="1"><testcase classname="b.test.ts" name="pass B" /></testsuite>']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /inconsistent JUnit failures count/);
});

test("preserves actual Vitest parameterized executions with repeated names", () => {
  const cases = '<testsuites tests="3"><testsuite tests="3">' +
    Array.from({length: 3}, () => '<testcase classname="table.test.ts" name="table scenario" />').join("") +
    '</testsuite></testsuites>';
  const result = probe([cases, xml("other.test.ts", "pass B")]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.xml, /tests="4"/);
  for (let i = 1; i <= 3; i++) {
    assert.ok(result.xml.includes("table scenario [JUnit occurrence " + i + "/3]"));
  }
  assert.equal((result.xml.match(/audit_original_name="table scenario"/g) || []).length, 3);
});

test("rejects a suite with all test cases skipped", () => {
  const skippedA = '<testsuite><testcase classname="a.test.ts" name="skip A"><skipped /></testcase></testsuite>';
  const skippedB = '<testsuite><testcase classname="b.test.ts" name="skip B"><skipped /></testcase></testsuite>';
  const result = probe([skippedA, skippedB]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no executed non-skipped testcases/);
});

test("rejects empty suites declaring failures or errors alongside passing suites", () => {
  for (const outcome of ["failures", "errors"]) {
    const source = '<testsuites><testsuite tests="1"><testcase classname="ok" name="pass"/></testsuite>' +
      '<testsuite tests="1" ' + outcome + '="1" /></testsuites>';
    const result = probe([source, xml("other.test.ts", "pass B")]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /inconsistent JUnit (tests|failures|errors) count/);
  }
});

test("rejects cases outside suites and unexpected suite children", () => {
  const misplaced = '<testsuites><testsuite tests="1"><testcase classname="ok" name="pass"/></testsuite>' +
    '<testcase classname="hidden" name="fail"><failure /></testcase></testsuites>';
  const unexpected = '<testsuite tests="1"><testcase classname="ok" name="pass"/>' +
    '<metadata><testcase classname="hidden" name="fail"><failure /></testcase></metadata></testsuite>';
  for (const malformed of [misplaced, unexpected]) {
    const result = probe([malformed, xml("other.test.ts", "pass B")]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /unexpected JUnit element/);
  }
});

test("rejects a fully skipped shard even when another shard passes", () => {
  const onlySkipped = '<testsuite tests="1" skipped="1">' +
    '<testcase classname="skip.test.ts" name="skip"><skipped /></testcase></testsuite>';
  const result = probe([onlySkipped, xml("other.test.ts", "pass B")]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /shard 1 has no executed non-skipped testcases/);
});

test("rejects dangling output symlink without creating its target", () => {
  const result = probe([xml("a.test.ts", "pass A"), xml("b.test.ts", "pass B")],
    ({ work, output }) => {
      const target = join(work, "unexpected-output.xml");
      assert.equal(existsSync(target), false);
      symlinkSync(target, output);
      return { output, inspect: () => existsSync(target) };
    });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /JUnit destination cannot be a symlink/);
  assert.equal(result.effects, false);
});

test("rejects output through a symlink parent", () => {
  const result = probe([xml("a.test.ts", "pass A"), xml("b.test.ts", "pass B")],
    ({ work }) => {
      const real = join(work, "outside");
      mkdirSync(real);
      symlinkSync(real, join(work, "linked"), "dir");
      return { output: join(work, "linked", "combined.xml"),
        inspect: () => existsSync(join(real, "combined.xml")) };
    });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /BLOCK:/);
  assert.equal(result.effects, false);
});

test("rejects existing output symlink rather than modifying its target", () => {
  const result = probe([xml("a.test.ts", "pass A"), xml("b.test.ts", "pass B")],
    ({ work, output }) => {
      const target = join(work, "already-present.xml");
      writeFileSync(target, "keep unchanged");
      symlinkSync(target, output);
      return { output, inspect: () => readFileSync(target, "utf8") };
    });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /JUnit destination cannot be a symlink/);
  assert.equal(result.effects, "keep unchanged");
});
