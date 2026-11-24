#!/usr/bin/env python3
"""Fail-closed M1 bootstrap for #1345; deliberately never certifies a review.

Candidate code runs with read-only permissions. Its success is only a static
configuration preflight, not a trusted independent/session attestation.
"""
from __future__ import annotations

import json
import re
import hashlib
from pathlib import Path
from verify_session_m1_controls import validate_dossier_bindings
from operator_session_workflow_guards import (
    TRUSTED_PACKET_EVENTS, TRUSTED_PACKET_JOB_GUARD,
    TRUSTED_SESSION_EVENTS, TRUSTED_SESSION_JOB_GUARD,
    verify_trusted_wrapper_boundaries,
)

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


def verify_release_probe_trigger_paths(workflow: str) -> None:
    """Keep the read-only preflight reachable when only the release wrapper changes."""
    probe_path = "      - '.github/workflows/release-handoff-probe.yml'"
    for event in ("pull_request", "push"):
        pattern = rf"(?m)^  {event}:\n    branches: \[develop, main\]\n    paths:\n((?:      - [^\n]+\n)+)"
        sections = re.findall(pattern, workflow)
        require(len(sections) == 1 and sections[0].splitlines().count(probe_path) == 1,
                f"release probe changes must trigger {event} preflight on develop/main")


def validate(integration: dict, policy: dict, workflow: str,
             collector_workflow: str | None = None,
             publisher_workflow: str | None = None) -> None:
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
    verify_release_probe_trigger_paths(workflow)

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
                 else (ROOT / ".github/workflows/handoff-evidence.yml").read_text())
    expected = (f"uses: {SOURCE_REPOSITORY}/.github/workflows/reusable-handoff.yml@"
                f"{source['ref']}")
    require("name: Collect and certify exact-SHA handoff" in collector
            and expected in collector
            and "name: Certified semantic handoff pilot (fail closed)" in collector,
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

    publisher = (publisher_workflow if publisher_workflow is not None
                 else (ROOT / ".github/workflows/publish-certified-handoff.yml").read_text())
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
            and "producer-path: .github/workflows/handoff-evidence.yml" in publisher
            and "required-checks: Collect and certify exact-SHA handoff" in publisher,
            "publisher does not bind exact consumer producer and base")




    # Official consumer TECHNICAL checks must come from the paths and names
    # authenticated by verify_independent_pr_audit.py. These are supplemental
    # to the existing Agent-first gate and cannot be converted to a no-op.
    technical = (
        (".github/workflows/validate.yml", "name: Structure and tests",
         ("pnpm check", "pnpm architecture:check", "pnpm docs:check", "pnpm build",
          "node --test scripts/ci-classifier.test.mjs")),
        (".github/workflows/github-audit-mcp.yml", "name: Offline authorization tests",
         ("pnpm exec vitest run", "server/auth.local.test.ts",
          "server/auth.logout.test.ts", "whatsappAuthorization.test.ts",
          "billingRolloutAdminAuthorization.test.ts")),
    )
    for path, expected_name, commands in technical:
        source = (ROOT / path).read_text()
        require(expected_name in source and "ref: ${{ github.event.pull_request.head.sha }}" in source,
                f"{path}: missing authenticated check identity or exact-HEAD checkout")
        require(re.search(r"(?m)^permissions:\s*\n\s+contents: read\s*$", source) is not None
                and re.search(r"(?m)^\s*(checks|contents|issues|pull-requests|actions):\s*write\s*$", source) is None,
                f"{path}: privileged technical checks are forbidden")
        require(all(command in source for command in commands)
                and "fetch-depth: 0" in source
                and "persist-credentials: false" in source
                and "pnpm install --frozen-lockfile" in source
                and "continue-on-error:" not in source,
                f"{path}: real technical checks or fail-closed behavior missing")



def verify_official_mirror(manifest: dict | None = None) -> None:
    """Validate pinned upstream Git blob identities; not a reviewer verdict."""
    if manifest is None:
        manifest = strict_json(
            (ROOT / ".github/operator-session-tooling-lock.json").read_text())
    require(set(manifest) == {
        "schema_version", "repository", "official_repository", "official_commit", "required_paths"
    }, "tooling lock schema drift")
    require(type(manifest["schema_version"]) is int and manifest["schema_version"] == 1
            and manifest["repository"] == REPOSITORY
            and manifest["official_repository"] == SOURCE_REPOSITORY,
            "tooling lock provenance mismatch")
    pinned = strict_json((ROOT / ".github/operator-session-integration.json").read_text())
    require(manifest["official_commit"] == pinned["official_source"]["ref"],
            "tooling lock is not pinned to official Skill source")
    expected = (
        "scripts/session_review.py", "scripts/session_review_github.py",
        "scripts/verify_session_review.py", "scripts/verify_independent_pr_audit.py",
        "entregar-issue/scripts/specification.py",
        "entregar-issue/scripts/require_actions_handoff_certificate.py",
        "entregar-issue/scripts/handoff_merge_preview.py",
        "entregar-issue/scripts/handoff_postcondition.py",
        "entregar-issue/scripts/handoff_postcondition_records.py",
        "entregar-issue/scripts/certificate_postcondition_replay.py",
        "entregar-issue/scripts/certificate_replay_io.py",
        "entregar-issue/scripts/certificate_replay_source.py",
        "entregar-issue/scripts/audit_artifact_io.py",
        "entregar-issue/scripts/certificate_replay_inputs.py",
        "entregar-issue/scripts/build_test_candidate_index.py",
    )
    files = manifest["required_paths"]
    require(isinstance(files, dict) and set(files) == set(expected),
            "official verifier mirror is incomplete or has extra paths")
    for path, wanted in files.items():
        require(isinstance(wanted, str) and PIN_PATTERN.fullmatch(wanted),
                "invalid official Git blob identifier")
        raw = (ROOT / path).read_bytes()
        actual = hashlib.sha1(
            b"blob " + str(len(raw)).encode("ascii") + b"\x00" + raw,
            usedforsecurity=False).hexdigest()
        require(actual == wanted, f"official mirrored tooling differs from pinned blob: {path}")


def verify_bootstrap_wrappers(session: str | None = None, packet: str | None = None) -> None:
    if session is None:
        session = (ROOT / ".github/workflows/session-review.yml").read_text()
    if packet is None:
        packet = (ROOT / ".github/workflows/prepare-neutral-audit-packet.yml").read_text()
    skill = "ref: " + strict_json(
        (ROOT / ".github/operator-session-integration.json").read_text()
    )["official_source"]["ref"]
    require("name: Verify operator-attested session review" in session
            and "vars.SOLVERIT_SESSION_REVIEW_ENABLED == 'true'" in session
            and "ref: ${{ github.workflow_sha }}" in session
            and skill in session
            and "repository: crgasparoto-br/skill" in session
            and "python .solverit-skill/scripts/verify_session_review.py" in session,
            "session verifier must use trusted source and disabled rollout guard")
    require("checks: write" in session
            and "persist-credentials: false" in session
            and "cp .github/session-review-policy.json" in session
            and "cp .github/workflows/session-review.yml" in session
            and "continue-on-error:" not in session,
            "session verifier missing trusted boundaries")
    require("name: Prepare neutral independent audit packet" in packet
            and "ref: ${{ github.workflow_sha }}" in packet
            and skill in packet
            and "python - <<'PY'" in packet
            and "from verify_session_review import evaluate, resolve_targets" in packet
            and "if-no-files-found: error" in packet,
            "neutral packet must use trusted exact-SHA evidence reader")
    require("checks: write" not in packet
            and "contents: write" not in packet
            and "github.event.repository.default_branch" in packet
            and "github.event.comment.body == '/solverit-audit-packet'" in packet
            and "persist-credentials: false" in packet,
            "neutral packet must be read-only default-branch request")
    require("continue-on-error:" not in packet,
            "neutral evidence cannot be silently skipped")
    verify_trusted_wrapper_boundaries(
        session, job="verify", events=TRUSTED_SESSION_EVENTS,
        permissions="  contents: read\n  issues: read\n  pull-requests: read\n"
                    "  actions: read\n  checks: write\n",
        guard=TRUSTED_SESSION_JOB_GUARD)
    verify_trusted_wrapper_boundaries(
        packet, job="packet", events=TRUSTED_PACKET_EVENTS,
        permissions="  contents: read\n  issues: read\n  pull-requests: read\n"
                    "  checks: read\n  actions: read\n",
        guard=TRUSTED_PACKET_JOB_GUARD)


RELEASE_PROBE_NAME = "Release handoff probe (read-only)"
RELEASE_PROBE_GUARD = (
    "${{ github.event_name == 'pull_request' && github.event.pull_request.base.ref == 'main' "
    "&& github.event.pull_request.head.repo.full_name == github.repository "
    "&& github.event.pull_request.draft == false && "
    "contains(github.event.pull_request.labels.*.name, 'solverit-certified-handoff-main') }}"
)


def verify_release_probe(workflows: Path, pin: str) -> None:
    """Static preflight for the intentionally untrusted, read-only release pilot."""
    require(PIN_PATTERN.fullmatch(pin) is not None, "release probe needs immutable official pin")
    canonical = (workflows / "handoff-evidence.yml").read_text(encoding="utf-8")
    probe = (workflows / "release-handoff-probe.yml").read_text(encoding="utf-8")
    command_lines = []
    for key in ("tooling-repository", "python-version", "install-command", "test-command", "evidence-command"):
        lines = re.findall(rf"(?m)^      {key}: [^\n]+$", canonical)
        require(len(lines) == 1, f"release evidence must match one canonical {key}")
        command_lines.extend(lines)
    expected = [
        f"name: {RELEASE_PROBE_NAME}",
        "on:",
        "  pull_request:",
        "    branches: [main]",
        "    types: [opened, synchronize, reopened, ready_for_review, labeled]",
        "permissions:",
        "  contents: read",
        "  issues: read",
        "  pull-requests: read",
        "jobs:",
        "  release-probe:",
        "    name: Validate main-target release evidence (no publication)",
        f"    if: {RELEASE_PROBE_GUARD}",
        f"    uses: {SOURCE_REPOSITORY}/.github/workflows/reusable-handoff.yml@{pin}",
        "    with:",
        "      base-ref: main",
        *command_lines,
    ]
    actual = [line for line in probe.splitlines() if line and not line.startswith("#")]
    require(actual == expected, "release probe must remain single-job, read-only, exact-base and opt-in")

    # Existing publication and operator session automation must not consume it.
    # The trust store separately authorizes the original handoff producer path.
    for path in ("publish-certified-handoff.yml", "prepare-neutral-audit-packet.yml", "session-review.yml"):
        consumer = (workflows / path).read_text(encoding="utf-8")
        require(RELEASE_PROBE_NAME not in consumer, "trusted consumer must not subscribe to release probe")


def main() -> None:
    integration = strict_json((ROOT / ".github/operator-session-integration.json").read_text())
    policy = strict_json((ROOT / ".github/session-review-policy.json").read_text())
    workflow = (ROOT / ".github/workflows/operator-session-preflight.yml").read_text()
    validate(integration, policy, workflow)
    verify_official_mirror()
    verify_bootstrap_wrappers()
    verify_release_probe(ROOT / ".github/workflows", integration["official_source"]["ref"])
    dossier = ROOT / ".github/handoff-evidence/issue-1345"
    validate_dossier_bindings(
        strict_json((dossier / "manifest.json").read_text()),
        strict_json((dossier / "reviewed-closure.json").read_text()),
    )
    print("PASS: operator-session M1 metadata and read-only preflight are fail-closed")
    print("NOT CERTIFIED: no session receipt or independent audit approval is issued")


if __name__ == "__main__":
    main()
