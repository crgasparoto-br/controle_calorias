#!/usr/bin/env python3
"""Require genuinely executed M1-04 *contract* controls in pinned JUnit XML.

This checks execution facts, not reviewer independence, live GitHub attacks,
semantic equivalence, a certified handoff, or permission to enable M2.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from xml.etree import ElementTree

PINNED_SKILL = "71217ab40be73f64180f253816d7b5214cb23100"
# Each obligation is represented by a distinct, relevant executed case.
# The last dimension intentionally exercises actual consumer binding code.
SCENARIOS = {
    "review-positive": ("official", "tests.test_session_review", "test_single_account_can_submit_only_explicitly_limited_review"),
    "review-absent": ("official", "tests.test_session_review", "test_counterexamples_cannot_be_approved"),
    "session-forgery": ("official", "tests.test_session_review", "test_recovered_provenance_adversarial_mutations_block"),
    "comment-revocation": ("official", "tests.test_session_review_runner", "test_edit_removing_marker_still_revokes"),
    "sha-and-issue-drift": ("official", "tests.test_session_review_runner", "test_evaluate_rejects_changed_initial_identity"),
    "base-drift": ("official", "tests.test_session_certificate_event", "test_preview_reconciliation_requires_exact_base_and_head_before_api"),
    "control-absent": ("official", "tests.test_session_review_dossier", "test_dossier_cannot_promote_unexecuted_controls"),
    "ci-handoff-failure": ("official", "tests.test_session_certificate_event", "test_certified_evidence_checks_pretest_event_before_verifier"),
    "operator-unauthorized": ("official", "tests.test_session_review_runner", "test_review_rechecks_operator_permission_before_publication"),
    "two-pr-same-head": ("candidate", "tests.test_session_m1_controls", "test_same_head_pr_reviews_are_separate"),
    "untrusted-workflow": ("official", "tests.test_session_review_workflows", "test_candidate_selected_refs_cannot_start_review_workflows"),
}
# Reviewed parameter counts in the immutable official six-suite JUnit. A shrink
# must not turn a test *name* into a false claim of exhaustive attack coverage.
EXPECTED_COUNTS = {
    "review-positive": 1, "review-absent": 17, "session-forgery": 20,
    "comment-revocation": 1, "sha-and-issue-drift": 6, "base-drift": 1,
    "control-absent": 3, "ci-handoff-failure": 11, "operator-unauthorized": 1,
    "two-pr-same-head": 1, "untrusted-workflow": 2,
}



def read_cases(path: Path) -> tuple[list[dict[str, str]], str]:
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= 4_000_000:
        raise ValueError("missing, redirected or oversized actual JUnit")
    raw = path.read_bytes()
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise ValueError("DTD/entities prohibited in JUnit")
    root = ElementTree.fromstring(raw)
    if root.tag not in {"testsuite", "testsuites"}:
        raise ValueError("unexpected JUnit root")
    cases = []
    seen = set()
    for node in root.iter("testcase"):
        module, name = node.get("classname", ""), node.get("name", "")
        if not module or not name or (module, name) in seen:
            raise ValueError("missing or repeated executed JUnit case identity")
        seen.add((module, name))
        cases.append({"module": module, "name": name,
                      "result": "blocked" if any(node.find(x) is not None for x in ("failure", "error", "skipped")) else "passed"})
    if not cases:
        raise ValueError("no executed JUnit cases")
    for suite in root.iter("testsuite"):
        if suite.get("tests") is not None and int(suite.get("tests", "-1")) != len(list(suite.iter("testcase"))):
            raise ValueError("JUnit declared tests differ from actual cases")
    return cases, hashlib.sha256(raw).hexdigest()


def validate(official: Path, candidate: Path, head_sha: str) -> dict:
    if not re.fullmatch(r"[0-9a-f]{40}", head_sha):
        raise ValueError("non-exact material SHA")
    inventories = {}
    sources = {}
    for kind, path in (("official", official), ("candidate", candidate)):
        inventories[kind], sources[kind] = read_cases(path)
    proofs = []
    for scenario, (kind, module, name) in SCENARIOS.items():
        exact = [case for case in inventories[kind]
                 if (case["module"] == module or (kind == "candidate" and case["module"].startswith(module + ".")))
                 and (case["name"] == name or case["name"].startswith(name + "["))]
        if len(exact) != EXPECTED_COUNTS[scenario] or any(c["result"] != "passed" for c in exact):
            raise ValueError(f"M1-04 executed control is missing, duplicated, failed or skipped: {scenario}")
        proofs.append({"scenario": scenario, "origin": kind, "module": module, "case": name, "executions": len(exact), "result": "passed"})
    return {"schema_version": 1, "material_head_sha": head_sha, "official_skill_sha": PINNED_SKILL,
            "evidence_kind": "executed-contract-unit-tests", "live_github_adversarial_proof": "NOT_ASSERTED",
            "semantic_certification": "NOT_ASSERTED", "session_review_approval": "NOT_ASSERTED",
            "junit_sha256": sources, "executed_case_count": {k: len(v) for k, v in inventories.items()},
            "scenario_controls": proofs}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--official-junit", type=Path, required=True)
    parser.add_argument("--candidate-junit", type=Path, required=True)
    parser.add_argument("--head-sha", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    report = validate(args.official_junit, args.candidate_junit, args.head_sha)
    args.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"M1-04 CONTRACT PROBES: {len(report['scenario_controls'])} executed; live approval UNKNOWN")


if __name__ == "__main__":
    main()
