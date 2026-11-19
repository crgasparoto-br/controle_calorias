#!/usr/bin/env python3
"""Fail-closed M1 bootstrap for #1345; deliberately never certifies a review.

Candidate code runs with read-only permissions. Its success is only a static
configuration preflight, not a trusted independent/session attestation.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIN_PATTERN = re.compile(r"[0-9a-f]{40}\Z")
REPOSITORY = "crgasparoto-br/controle_calorias"
SOURCE_REPOSITORY = "crgasparoto-br/skill"
OPERATOR_ID = 255721831
OPERATOR_LOGIN = "crgasparoto-br"
REQUIRED_PREREQUISITES = frozenset({
    "certified-semantic-handoff",
    "real-junit-positive-negative-regression",
    "trusted-neutral-audit-packet",
    "exact-sha-evidence",
    "separate-real-audit-context",
    "authenticated-session-review-receipt",
    "verified-default-and-base-installation",
})


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def strict_json(text: str) -> dict:
    def unique(pairs: list[tuple[str, object]]) -> dict:
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate JSON key")
            result[key] = value
        return result

    result = json.loads(text, object_pairs_hook=unique)
    require(isinstance(result, dict), "root must be JSON object")
    return result


def validate(integration: dict, policy: dict, workflow: str,
             collector_workflow: str | None = None) -> None:
    require(set(integration) == {
        "schema_version", "repository", "issue", "stage",
        "session_review_check_enabled", "session_review_required",
        "official_source", "operator", "existing_required_check",
        "prerequisites",
    }, "unexpected integration metadata fields")
    require(type(integration["schema_version"]) is int and integration["schema_version"] == 1,
            "unsupported schema")
    require(integration["repository"] == REPOSITORY and integration["issue"] == 1345,
            "unexpected target")
    require(integration["stage"] == "preflight-only", "bootstrap cannot activate certification")
    require(integration["session_review_check_enabled"] is False
            and integration["session_review_required"] is False,
            "M1 must not claim approval authority")
    require(integration["existing_required_check"] == "Agent-first gate",
            "existing technical gate must be preserved")
    require(isinstance(integration["prerequisites"], list)
            and set(integration["prerequisites"]) == REQUIRED_PREREQUISITES
            and len(integration["prerequisites"]) == len(REQUIRED_PREREQUISITES),
            "mandatory rollout prerequisites missing or duplicated")
    source = integration["official_source"]
    require(isinstance(source, dict)
            and set(source) == {"repository", "ref", "policy_blob", "verifier_blob"}
            and source["repository"] == SOURCE_REPOSITORY
            and all(isinstance(source.get(key), str) and PIN_PATTERN.fullmatch(source[key])
                    for key in ("ref", "policy_blob", "verifier_blob")),
            "official skill version must be immutable and fully pinned")
    require(integration["operator"] == {
        "github_id": OPERATOR_ID, "github_login": OPERATOR_LOGIN
    }, "operator identity mismatch")
    require(set(policy) == {
        "schema_version", "mode", "assurance", "acknowledgement",
        "operators", "implementation_provenance"
    }, "unexpected session policy fields")
    require(type(policy["schema_version"]) is int and policy["schema_version"] == 1,
            "unsupported session policy")
    require(policy["mode"] == "disabled", "policy cannot be self-activated by candidate")
    require(policy["assurance"] == "operator-attested-session-review"
            and policy["acknowledgement"] == "separate-context-declared-not-cryptographically-proven",
            "session review cannot claim third-party assurance")
    require(policy["operators"] == [{"id": OPERATOR_ID, "login": OPERATOR_LOGIN}],
            "operator allowlist mismatch")
    require(policy["implementation_provenance"] == {
        "mode": "enabled", "type": "github-implementation-provenance"
    }, "implementation origin recovery contract mismatch")
    require("name: Operator session certification preflight" in workflow
            and "Operator session safety preflight (non-certifying)" in workflow,
            "unexpected workflow identity")
    require(re.search(r"(?m)^permissions:\s*\n\s+contents: read\s*$", workflow) is not None,
            "workflow must have globally read-only permissions")
    require(re.search(r"(?m)^\s*(checks|issues|pull-requests|actions):\s*write\s*$", workflow) is None,
            "M1 workflow cannot write checks or reviews")
    require(re.search(r"(?m)^\s*pull_request_target:\s*$", workflow) is None,
            "M1 cannot run elevated pull_request_target event")
    require("persist-credentials: false" in workflow
            and "python scripts/operator_session_preflight.py" in workflow
            and "python -m unittest discover" in workflow,
            "missing unprivileged preflight or self-test")

    require("Pinned official session contract regression (non-certifying)" in workflow
            and "repository: crgasparoto-br/skill" in workflow
            and f"ref: {source['ref']}" in workflow
            and "python -m pytest -q" in workflow
            and all(case in workflow for case in (
                "tests/test_session_review.py",
                "tests/test_session_review_dossier.py",
                "tests/test_session_review_runner.py",
                "tests/test_session_review_workflows.py",
                "tests/test_session_certificate_event.py",
                "tests/test_plan_session_ruleset_m2.py",
            )),
            "trusted upstream adversarial suites and source pin are required")

    collector = (collector_workflow if collector_workflow is not None
                 else (ROOT / ".github/workflows/collect-certified-handoff.yml").read_text())
    expected = (f"uses: {SOURCE_REPOSITORY}/.github/workflows/reusable-handoff.yml@"
                f"{source['ref']}")
    require("name: Collect and certify exact-SHA handoff" in collector
            and expected in collector
            and "name: Pilot certified semantic handoff (fail closed)" in collector,
            "missing or unpinned official handoff producer")
    require(re.search(r"(?m)^permissions:\s*\n\s+contents: read\s*\n\s+issues: read\s*\n\s+pull-requests: read\s*$",
                      collector) is not None,
            "handoff pilot requires read-only permissions")
    require(re.search(r"(?m)^\s*(checks|contents|issues|pull-requests|actions):\s*write\s*$",
                      collector) is None
            and re.search(r"(?m)^\s*(pull_request_target|workflow_dispatch|issue_comment):\s*$",
                          collector) is None,
            "untrusted candidate must not control a privileged handoff job")
    require("contains(github.event.pull_request.labels.*.name, 'solverit-certified-handoff')" in collector,
            "certification pilot must be explicitly opted into")
    require("base-ref: develop" in collector
            and "python -m pytest -vv tests/test_operator_session_preflight.py" in collector
            and '--junitxml="$EVIDENCE_DIR/pytest-exact-head.xml"' in collector
            and "produce_actions_handoff_evidence.py" in collector
            and '--event "$GITHUB_EVENT_PATH"' in collector,
            "certification requires exact-head JUnit and reviewed semantic closure")
    require("continue-on-error:" not in collector
            and "if-no-files-found: ignore" not in collector,
            "certification evidence must fail closed")

    publisher = (ROOT / ".github/workflows/publish-certified-handoff.yml").read_text()
    expected_publisher = (f"uses: {SOURCE_REPOSITORY}/"
                          f".github/workflows/reusable-publish-handoff.yml@{source['ref']}")
    require("name: Publish certified handoff (trusted)" in publisher
            and expected_publisher in publisher,
            "untrusted or unpinned handoff publisher")
    require(re.search(r"(?m)^permissions:\s*\n\s+contents: write\s*\n\s+actions: read\s*\n\s+pull-requests: read\s*$",
                      publisher) is not None,
            "handoff publisher requires exact permission boundary")
    require("workflow_run:" in publisher
            and "workflows: [\"Collect and certify exact-SHA handoff\"]" in publisher
            and "github.event.workflow_run.conclusion == 'success'" in publisher
            and "github.event.workflow_run.event == 'pull_request'" in publisher
            and "github.event.workflow_run.head_repository.full_name == github.repository" in publisher
            and "github.event.repository.default_branch" in publisher,
            "publisher is not bound to trusted default-branch certified workflow")
    require(re.search(r"(?m)^\s*(pull_request_target|workflow_dispatch|issue_comment):\s*$",
                      publisher) is None
            and "continue-on-error:" not in publisher
            and "    steps:" not in publisher,
            "handoff publisher must not execute candidate code or accept untrusted dispatch")
    require("base-ref: develop" in publisher
            and "producer-path: .github/workflows/collect-certified-handoff.yml" in publisher
            and "required-checks: Collect and certify exact-SHA handoff" in publisher,
            "publisher does not bind exact consumer producer and base")


def main() -> None:
    integration = strict_json((ROOT / ".github/operator-session-integration.json").read_text())
    policy = strict_json((ROOT / ".github/session-review-policy.json").read_text())
    workflow = (ROOT / ".github/workflows/operator-session-preflight.yml").read_text()
    validate(integration, policy, workflow)
    print("PASS: operator-session M1 metadata and read-only preflight are fail-closed")
    print("NOT CERTIFIED: no session receipt or independent audit approval is issued")


if __name__ == "__main__":
    main()
