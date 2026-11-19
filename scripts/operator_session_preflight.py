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
PIN_PATTERN = re.compile(r"[0-9a-f]{40}\\Z")
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


def validate(integration: dict, policy: dict, workflow: str) -> None:
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
    require(re.search(r"(?m)^permissions:\\s*\\n\\s+contents: read\\s*$", workflow) is not None,
            "workflow must have globally read-only permissions")
    require(re.search(r"(?m)^\\s*(checks|issues|pull-requests|actions):\\s*write\\s*$", workflow) is None,
            "M1 workflow cannot write checks or reviews")
    require(re.search(r"(?m)^\\s*pull_request_target:\\s*$", workflow) is None,
            "M1 cannot run elevated pull_request_target event")
    require("persist-credentials: false" in workflow
            and "python scripts/operator_session_preflight.py" in workflow
            and "python -m unittest discover" in workflow,
            "missing unprivileged preflight or self-test")


def main() -> None:
    integration = strict_json((ROOT / ".github/operator-session-integration.json").read_text())
    policy = strict_json((ROOT / ".github/session-review-policy.json").read_text())
    workflow = (ROOT / ".github/workflows/operator-session-preflight.yml").read_text()
    validate(integration, policy, workflow)
    print("PASS: operator-session M1 metadata and read-only preflight are fail-closed")
    print("NOT CERTIFIED: no session receipt or independent audit approval is issued")


if __name__ == "__main__":
    main()
