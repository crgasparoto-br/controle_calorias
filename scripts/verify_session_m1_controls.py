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
    "review-invalid": ("official", "tests.test_session_review", "test_counterexamples_cannot_be_approved"),
    "review-absent": ("candidate", "tests.test_session_m1_controls", "test_missing_review_is_blocked"),
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
    "review-positive": 1, "review-invalid": 17, "review-absent": 1, "session-forgery": 20,
    "comment-revocation": 1, "sha-and-issue-drift": 6, "base-drift": 1,
    "control-absent": 3, "ci-handoff-failure": 11, "operator-unauthorized": 1,
    "two-pr-same-head": 1, "untrusted-workflow": 2,
}



def read_cases(path: Path) -> tuple[list[dict[str, str]], str]:
    """Verify entire JUnit tree before trusting any selected scenario.

    This is deliberately stricter than looking up successful test names: a
    forged XML must not hide failing siblings, malformed hierarchy or false
    suite totals while allowing the selected control names to pass.
    """
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= 4_000_000:
        raise ValueError("missing, redirected or oversized actual JUnit")
    raw = path.read_bytes()
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise ValueError("DTD/entities prohibited in JUnit")
    root = ElementTree.fromstring(raw)
    if root.tag not in {"testsuite", "testsuites"}:
        raise ValueError("unexpected JUnit root")
    suites = [root] if root.tag == "testsuite" else list(root)
    if not suites or any(suite.tag != "testsuite" for suite in suites):
        raise ValueError("JUnit requires nonempty testsuite hierarchy")

    def allow_children(node: ElementTree.Element, allowed: set[str]) -> None:
        for child in node:
            if child.tag not in allowed:
                raise ValueError(f"unexpected JUnit child: {child.tag}")
            if child.tag == "properties":
                allow_children(child, {"property"})
            elif child.tag != "testcase":
                allow_children(child, set())

    def declared_counts(node: ElementTree.Element, observed: dict[str, int]) -> None:
        for key, actual in observed.items():
            declared = node.get(key)
            if declared is not None and (not declared.isdecimal() or int(declared) != actual):
                raise ValueError(f"inconsistent JUnit {key} count")

    cases: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    totals = {key: 0 for key in ("tests", "failures", "errors", "skipped")}
    for suite in suites:
        allow_children(suite, {"testcase", "properties", "system-out", "system-err"})
        counts = {key: 0 for key in totals}
        for node in suite:
            if node.tag != "testcase":
                continue
            allow_children(node, {"failure", "error", "skipped", "properties", "system-out", "system-err"})
            module, name = node.get("classname", "").strip(), node.get("name", "").strip()
            if not module or not name or (module, name) in seen:
                raise ValueError("missing or repeated executed JUnit case identity")
            seen.add((module, name))
            outcomes = [key for key in ("failure", "error", "skipped") if node.find(key) is not None]
            if len(outcomes) > 1:
                raise ValueError("contradictory JUnit outcome")
            if any(key in outcomes for key in ("failure", "error")):
                raise ValueError("failing or errored JUnit case outside selected controls")
            counts["tests"] += 1
            if outcomes:
                counts[outcomes[0]] += 1
            cases.append({"module": module, "name": name,
                          "result": "blocked" if outcomes else "passed"})
        if counts["tests"] == counts["skipped"]:
            raise ValueError("JUnit suite has no executed non-skipped testcases")
        declared_counts(suite, counts)
        for key in totals:
            totals[key] += counts[key]
    if not cases or totals["tests"] == totals["skipped"]:
        raise ValueError("no executed non-skipped JUnit cases")
    declared_counts(root, totals)
    return cases, hashlib.sha256(raw).hexdigest()


def validate_dossier_bindings(manifest: dict, reviewed: dict) -> None:
    """Reject self-contradictory provisional bindings before certification.

    The official producer must still authenticate every bound case against
    exact-SHA JUnit. This inexpensive source guard never marks a requirement
    covered, promotes a pending obligation, or issues a certificate.
    """
    if manifest.get("review_state") != "incomplete" or manifest.get("artifact_sha256") != {}:
        raise ValueError("provisional dossier cannot claim a semantic certificate")
    obligations = reviewed.get("obligations")
    if (reviewed.get("schema_version") != 1 or not isinstance(obligations, dict)
            or len(obligations) != 26
            or any(re.fullmatch(r"[0-9a-f]{64}", key) is None for key in obligations)):
        raise ValueError("incomplete canonical obligation inventory")
    covered: set[str] = set()
    for entry in obligations.values():
        if not isinstance(entry, dict):
            raise ValueError("invalid obligation closure record")
        if entry.get("disposition") == "covered":
            required = entry.get("requirement_ids")
            if (not isinstance(required, list) or not required
                    or any(not isinstance(rid, str) or not rid.strip() for rid in required)):
                raise ValueError("covered obligation has no requirement ID")
            covered.update(required)
    bindings = manifest.get("test_bindings")
    if not isinstance(bindings, dict) or set(bindings) != covered:
        raise ValueError("provisional test bindings differ from covered requirements")
    for requirement, groups in bindings.items():
        if not isinstance(groups, dict) or set(groups) != {"positive", "negative", "regression"}:
            raise ValueError(f"incomplete test control classes for {requirement}")
        case_ids: set[str] = set()
        for kind in ("positive", "negative", "regression"):
            values = groups[kind]
            if (not isinstance(values, list) or not values
                    or any(not isinstance(value, str) or "::" not in value for value in values)
                    or any(value in case_ids for value in values)):
                raise ValueError(f"missing, repeated or cross-reused {kind} test for {requirement}")
            case_ids.update(values)


def validate(official: Path, candidate: Path, head_sha: str) -> dict:
    if not re.fullmatch(r"[0-9a-f]{40}", head_sha):
        raise ValueError("non-exact material SHA")
    inventories = {}
    sources = {}
    for kind, path in (("official", official), ("candidate", candidate)):
        inventories[kind], sources[kind] = read_cases(path)
    proofs = []
    for scenario, (kind, module, name) in SCENARIOS.items():
        # pytest qualifies unittest class modules differently for a nested
        # read-only checkout (`.candidate/tests`) versus a repository root.
        # Only these two observed, exact consumer module identities are valid.
        allowed_modules = {module}
        if kind == "candidate":
            allowed_modules.update({module + ".SessionM1ExecutedMatrixTests",
                                    ".candidate." + module + ".SessionM1ExecutedMatrixTests"})
        exact = [case for case in inventories[kind]
                 if case["module"] in allowed_modules
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
