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

`semanticCoverage.test.ts` enforces selected domain invariants and MUST NOT be counted as independent semantic certification. Only entries with independent source evidence and a case-specific review artifact may advance in the ledger. The 355 ml on `c-cerveja-imagem` is packaging OCR, not proof of 355 ml consumed; the expected consumed quantity is therefore unspecified. A future case with an explicit user-confirmed serving may assert 355 ml, but must not reuse packaging OCR as consumption proof.

## Current boundary

The ledger contains 75 cases. Eleven cases now have narrowly scoped, literal semantic controls: Panco, Wickbold, peanut-label association, four non-food rejections (#437), and four Portuguese fractional-slice statements (#1037). The remaining 64 are explicitly pending. These controls do not verify external nutritional values. Structural checks across 75 cases, the 95% harness measurement, and green CI **do not** establish that 75 independently curated labels are correct.

Until every case has source-grounded evidence and independent review, do not mark AUD-1316-003 as closed and do not describe the corpus as semantically certified.

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
peanut controls are grandfathered by the narrow existing test. Pending entries
remain pending until independent review actually occurs. Run tests and CI on
the new HEAD and request an independent auditor decision before merging.
