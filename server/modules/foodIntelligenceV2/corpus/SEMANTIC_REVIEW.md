# Independent semantic review — Golden Food Corpus

This review ledger belongs to issue #1299 and PR #1316. Its purpose is to separate syntactic/harness success from independent correctness of expected food decisions.

## Review procedure

1. Select a `pending-independent-review` case from `semantic-review-ledger.json`.
2. Inspect its input and independently consult the incident evidence, applicable ADR decision, and when needed trustworthy external food-label/catalog evidence. Do not use the resolver output or the corpus expected value as the source of truth.
3. Check identity (including brand and variant), amount and unit, status/action, meal operation, nutrition provenance, ambiguity/clarification, and rejection behavior when applicable.
4. Record the independent evidence and reviewer decision in a new, case-specific test or independently sourced reviewed artifact. Include links or stable reference identifiers and keep any unresolved question open.
5. Change that case's ledger state only after a review artifact exists and the test validates the expected result against the independent source.
6. Run the focused corpus tests and the repository's required CI on the exact new HEAD. Obtain a new independent auditor decision.

## Audit reconciliation (AUD-1316-004 / AUD-1316-005)

`semanticCoverage.test.ts` enforces selected domain invariants and MUST NOT be counted as independent semantic certification. Only entries with independent source evidence and a case-specific review artifact may advance in the ledger. The 300 ml on `c-cerveja-imagem` is packaging OCR for Antarctica Original, not proof of 300 ml consumed; the expected consumed quantity is therefore unspecified. A future case with an explicit user-confirmed serving may assert 300 ml, but must not reuse packaging OCR as consumption proof.

## Current boundary (2026-10-12)

The versioned ledger tracks **75/75 cases** as `independent-control-tested` and the independent-review backlog contains **0 pending case labels**. Existing narrow literal controls are accompanied by case-specific reviewed JSON records for the remaining cases. This reflects documented, source-referenced **semantic expectations**, not a runtime/third-party certification of the resolver, provider, OCR, food-label numbers, or persisted user memory.

The harness is a test/calibration tool: its 95% match-rate calculation, metamorphic controls, structural validation, and green CI do not measure production accuracy by themselves. The reference resolver used in self-tests is deliberately synthetic. Integration with the productive Food Intelligence V2 resolver is outside issue #1299; real external-provider failure injection and a PostgreSQL restart are also not certified by this corpus.

A new external audit must still verify that the individual evidence records actually substantiate the labels, and separately check the changed harness implementation on the current exact HEAD. An empty review backlog is not an automatic auditor approval. Do not claim end-to-end accuracy or authorize merge from these counts alone.

## Required evidence artifact for a new independent sign-off

For every newly approved case, add a distinct JSON file at
`server/modules/foodIntelligenceV2/corpus/reviews/<case-id>.json` and set
`semantic-review-ledger.json` entry `evidence` to that repository-relative path.
The test checks that this file exists and names the exact case, an explicit
`approved` verdict, a nonempty reviewer, a reasoned decision, source IDs and
locators, and material review dimensions. For example:

```json
{
  "caseId": "c-example",
  "verdict": "approved",
  "reviewer": "independent-reviewer",
  "independentSources": [
    { "id": "incident-or-label-id", "locator": "stable-source-location" }
  ],
  "rationale": "Why the source independently supports the expected decision.",
  "dimensions": ["identity", "quantity", "action", "nutritionProvenance"]
}
```

The example is a schema illustration **not an approved review**. Every real
source must be verified independently of the corpus output; merely creating
the JSON file does not establish semantic truth. Existing Panco, Wickbold and
peanut controls are grandfathered by the narrow existing test. New or changed entries must be source-reviewed before being counted; the current
75-case ledger has no pending entries. Run tests and CI on the exact current HEAD
and request an independent auditor decision before merging.
