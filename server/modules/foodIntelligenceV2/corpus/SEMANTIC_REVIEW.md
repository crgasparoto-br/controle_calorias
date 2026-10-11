# Independent semantic review — Golden Food Corpus

This review ledger belongs to issue #1299 and PR #1316. Its purpose is to separate syntactic/harness success from independent correctness of expected food decisions.

## Review procedure

1. Select a `pending-independent-review` case from `semantic-review-ledger.json`.
2. Inspect its input and independently consult the incident evidence, applicable ADR decision, and when needed trustworthy external food-label/catalog evidence. Do not use the resolver output or the corpus expected value as the source of truth.
3. Check identity (including brand and variant), amount and unit, status/action, meal operation, nutrition provenance, ambiguity/clarification, and rejection behavior when applicable.
4. Record the independent evidence and reviewer decision in a new, case-specific test or independently sourced reviewed artifact. Include links or stable reference identifiers and keep any unresolved question open.
5. Change that case's ledger state only after a review artifact exists and the test validates the expected result against the independent source.
6. Run the focused corpus tests and the repository's required CI on the exact new HEAD. Obtain a new independent auditor decision.

## Current boundary

The ledger contains 75 cases. Three historical cases (Panco, Wickbold, and peanut-label association) have narrowly scoped independent semantic assertions. The remaining 72 are explicitly pending. Structural checks across 75 cases, the 95% harness measurement, and green CI **do not** establish that 75 independently curated labels are correct.

Until every case has externally grounded evidence and independent review, do not mark AUD-1316-003 as closed and do not describe the corpus as semantically certified.
