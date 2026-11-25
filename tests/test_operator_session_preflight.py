"""Adversarial and positive M1 bootstrap tests (#1345)."""
import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from operator_session_preflight import strict_json, validate, verify_official_mirror, verify_bootstrap_wrappers  # noqa: E402


class OperatorSessionPreflightTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.integration = json.loads((ROOT / ".github/operator-session-integration.json").read_text())
        cls.policy = json.loads((ROOT / ".github/session-review-policy.json").read_text())
        cls.workflow = (ROOT / ".github/workflows/operator-session-preflight.yml").read_text()
        cls.collector = (ROOT / ".github/workflows/handoff-evidence.yml").read_text()
        cls.publisher = (ROOT / ".github/workflows/publish-certified-handoff.yml").read_text()

    def assert_blocked(self, *, integration=None, policy=None, workflow=None, collector=None,
                       publisher=None):
        with self.assertRaises(ValueError):
            validate(integration if integration is not None else self.integration,
                     policy if policy is not None else self.policy,
                     workflow if workflow is not None else self.workflow,
                     collector if collector is not None else self.collector,
                     publisher if publisher is not None else self.publisher)

    def test_valid_preflight_without_approval(self):
        validate(self.integration, self.policy, self.workflow)
        self.assertFalse(self.integration["session_review_check_enabled"])

    def test_activation_is_blocked(self):
        value = copy.deepcopy(self.integration)
        value["session_review_check_enabled"] = True
        self.assert_blocked(integration=value)

    def test_required_check_is_not_implicitly_enabled(self):
        value = copy.deepcopy(self.integration)
        value["session_review_required"] = True
        self.assert_blocked(integration=value)

    def test_disabled_policy_cannot_be_activated_by_pr(self):
        value = copy.deepcopy(self.policy)
        value["mode"] = "enabled"
        self.assert_blocked(policy=value)

    def test_fake_independence_label(self):
        value = copy.deepcopy(self.policy)
        value["acknowledgement"] = "third-party-verified"
        self.assert_blocked(policy=value)

    def test_unapproved_operator(self):
        value = copy.deepcopy(self.policy)
        value["operators"] = [{"id": 1, "login": "other"}]
        self.assert_blocked(policy=value)

    def test_unpinned_skill_reference(self):
        value = copy.deepcopy(self.integration)
        value["official_source"]["ref"] = "develop"
        self.assert_blocked(integration=value)

    def test_prerequisite_removal(self):
        value = copy.deepcopy(self.integration)
        value["prerequisites"].remove("certified-semantic-handoff")
        self.assert_blocked(integration=value)

    def test_privileged_workflow(self):
        self.assert_blocked(workflow=self.workflow.replace(
            "  contents: read", "  contents: read\n  checks: write"))

    def test_elevated_pr_event(self):
        self.assert_blocked(workflow=self.workflow.replace(
            "  pull_request:", "  pull_request_target:"))

    def test_missing_tests(self):
        self.assert_blocked(workflow=self.workflow.replace(
            "python -m unittest discover", "python -m other discover"))


    def test_unpinned_official_reusable_workflow(self):
        self.assert_blocked(collector=self.collector.replace(
            "@71217ab40be73f64180f253816d7b5214cb23100", "@develop"))

    def test_wrong_official_reusable_workflow(self):
        self.assert_blocked(collector=self.collector.replace(
            "reusable-handoff.yml", "unknown-handoff.yml"))

    def test_collector_privileged_token(self):
        self.assert_blocked(collector=self.collector.replace(
            "  pull-requests: read", "  pull-requests: read\n  checks: write"))

    def test_collector_elevated_event(self):
        self.assert_blocked(collector=self.collector.replace(
            "  pull_request:", "  pull_request_target:"))

    def test_collector_base_must_remain_develop(self):
        self.assert_blocked(collector=self.collector.replace(
            "base-ref: develop", "base-ref: main"))

    def test_collector_requires_explicit_opt_in_label(self):
        self.assert_blocked(collector=self.collector.replace(
            "'solverit-certified-handoff'", "'no-label-gate'"))

    def test_collector_must_run_real_junit(self):
        self.assert_blocked(collector=self.collector.replace(
            '--junitxml="$EVIDENCE_DIR/pytest-exact-head.xml"', "--no-junit-report"))

    def test_collector_must_inspect_reviewed_closure(self):
        self.assert_blocked(collector=self.collector.replace(
            "produce_actions_handoff_evidence.py", "echo"))

    def test_collector_must_fail_closed(self):
        self.assert_blocked(collector=self.collector.replace(
            "    with:", "    continue-on-error: true\n    with:"))

    def test_publisher_is_validated_when_present(self):
        validate(self.integration, self.policy, self.workflow, self.collector)

    def test_publisher_source_must_be_pinned(self):
        self.assert_blocked(publisher=self.publisher.replace(
            "reusable-publish-handoff.yml@71217ab40be73f64180f253816d7b5214cb23100",
            "reusable-publish-handoff.yml@main"))

    def test_publisher_must_use_default_branch(self):
        self.assert_blocked(publisher=self.publisher.replace(
            "github.event.repository.default_branch", "'develop'"))

    def test_publisher_requires_successful_certified_producer(self):
        self.assert_blocked(publisher=self.publisher.replace(
            "github.event.workflow_run.conclusion == 'success'",
            "github.event.workflow_run.conclusion != 'success'"))

    def test_publisher_only_reacts_to_same_repo(self):
        self.assert_blocked(publisher=self.publisher.replace(
            "github.event.workflow_run.head_repository.full_name == github.repository",
            "github.event.workflow_run.head_repository.full_name != github.repository"))

    def test_publisher_does_not_execute_candidate_steps(self):
        self.assert_blocked(publisher=self.publisher.replace(
            "    with:", "    steps:\n      - run: echo unsafe\\n    with:"))

    def test_publisher_must_not_accept_manual_dispatch(self):
        self.assert_blocked(publisher=self.publisher.replace(
            "  workflow_run:", "  workflow_dispatch:"))

    def test_publisher_must_not_lose_strict_permissions(self):
        self.assert_blocked(publisher=self.publisher.replace(
            "  contents: write", "  contents: read"))

    def test_publisher_must_use_exact_producer_path(self):
        self.assert_blocked(publisher=self.publisher.replace(
            "producer-path: .github/workflows/handoff-evidence.yml",
            "producer-path: .github/workflows/unknown.yml"))


    def test_official_technical_check_paths_exist(self):
        for path, name in (
            (".github/workflows/validate.yml", "name: Structure and tests"),
            (".github/workflows/github-audit-mcp.yml", "name: Offline authorization tests"),
        ):
            text = (ROOT / path).read_text()
            self.assertIn(name, text)
            self.assertIn("ref: ${{ github.event.pull_request.head.sha }}", text)
            self.assertIn("fetch-depth: 0", text)


    def test_pinned_official_mirror_is_complete(self):
        verify_official_mirror()

    def test_official_mirror_rejects_hash_mismatch(self):
        manifest = json.loads((ROOT / ".github/operator-session-tooling-lock.json").read_text())
        manifest["required_paths"]["scripts/session_review.py"] = "0" * 40
        with self.assertRaises(ValueError):
            verify_official_mirror(manifest)

    def test_official_mirror_rejects_unpinned_source(self):
        manifest = json.loads((ROOT / ".github/operator-session-tooling-lock.json").read_text())
        manifest["official_commit"] = "0" * 40
        with self.assertRaises(ValueError):
            verify_official_mirror(manifest)

    def test_official_mirror_rejects_missing_validator(self):
        manifest = json.loads((ROOT / ".github/operator-session-tooling-lock.json").read_text())
        manifest["required_paths"].pop("scripts/verify_session_review.py")
        with self.assertRaises(ValueError):
            verify_official_mirror(manifest)

    def test_trusted_upstream_review_and_packet_bootstrap(self):
        verify_bootstrap_wrappers()

    def test_session_writer_cannot_be_armed_in_pr(self):
        session = (ROOT / ".github/workflows/session-review.yml").read_text()
        with self.assertRaises(ValueError):
            verify_bootstrap_wrappers(
                session=session.replace(
                    "vars.SOLVERIT_SESSION_REVIEW_ENABLED == 'true'", "true"))

    def test_session_writer_cannot_execute_candidate_code(self):
        session = (ROOT / ".github/workflows/session-review.yml").read_text()
        with self.assertRaises(ValueError):
            verify_bootstrap_wrappers(
                session=session.replace(
                    "ref: ${{ github.workflow_sha }}", "ref: ${{ github.event.pull_request.head.sha }}"))

    def test_session_writer_requires_pinned_skill_revision(self):
        session = (ROOT / ".github/workflows/session-review.yml").read_text()
        with self.assertRaises(ValueError):
            verify_bootstrap_wrappers(
                session=session.replace(
                    "ref: 71217ab40be73f64180f253816d7b5214cb23100", "ref: develop"))

    def test_neutral_packet_cannot_write_checks(self):
        packet = (ROOT / ".github/workflows/prepare-neutral-audit-packet.yml").read_text()
        with self.assertRaises(ValueError):
            verify_bootstrap_wrappers(
                packet=packet.replace(
                    "  checks: read", "  checks: write"))

    def test_neutral_packet_must_bind_default_branch(self):
        packet = (ROOT / ".github/workflows/prepare-neutral-audit-packet.yml").read_text()
        with self.assertRaises(ValueError):
            verify_bootstrap_wrappers(
                packet=packet.replace(
                    "github.event.repository.default_branch", "'develop'"))

    def test_session_writer_guard_cannot_be_replaced_by_unconditional_if(self):
        session = (ROOT / ".github/workflows/session-review.yml").read_text()
        self.assertIn("    if: >-", session)
        with self.assertRaisesRegex(ValueError, "effective trusted job guard"):
            verify_bootstrap_wrappers(session=session.replace(
                "    if: >-", "    # vars.SOLVERIT_SESSION_REVIEW_ENABLED == 'true'\n"
                            "    if: >-\n      true &&", 1))

    def test_session_writer_cannot_add_second_job_without_guard(self):
        session = (ROOT / ".github/workflows/session-review.yml").read_text()
        session += "\n  unsafe_job:\n    runs-on: ubuntu-latest\n    steps: []\n"
        with self.assertRaisesRegex(ValueError, "unexpected or individually privileged job"):
            verify_bootstrap_wrappers(session=session)

    def test_session_writer_cannot_add_manual_event(self):
        session = (ROOT / ".github/workflows/session-review.yml").read_text()
        with self.assertRaisesRegex(ValueError, "untrusted event trigger"):
            verify_bootstrap_wrappers(session=session.replace(
                "on:\n  issue_comment:", "on:\n  workflow_dispatch:\n  issue_comment:", 1))

    def test_session_writer_cannot_escalate_job_permission(self):
        session = (ROOT / ".github/workflows/session-review.yml").read_text()
        with self.assertRaisesRegex(ValueError, "unexpected or individually privileged job"):
            verify_bootstrap_wrappers(session=session.replace(
                "  verify:\n", "  verify:\n    permissions: write-all\n", 1))

    def test_session_writer_cannot_remove_head_repository_guard(self):
        session = (ROOT / ".github/workflows/session-review.yml").read_text()
        with self.assertRaisesRegex(ValueError, "effective trusted job guard"):
            verify_bootstrap_wrappers(session=session.replace(
                "github.event.workflow_run.head_repository.full_name == github.repository",
                "github.event.workflow_run.head_repository.full_name != github.repository", 1))

    def test_neutral_packet_cannot_remove_certification_success_guard(self):
        packet = (ROOT / ".github/workflows/prepare-neutral-audit-packet.yml").read_text()
        with self.assertRaisesRegex(ValueError, "effective trusted job guard"):
            verify_bootstrap_wrappers(packet=packet.replace(
                "github.event.workflow_run.conclusion == 'success'",
                "github.event.workflow_run.conclusion != 'success'", 1))

    def test_neutral_packet_cannot_add_manual_event(self):
        packet = (ROOT / ".github/workflows/prepare-neutral-audit-packet.yml").read_text()
        with self.assertRaisesRegex(ValueError, "untrusted event trigger"):
            verify_bootstrap_wrappers(packet=packet.replace(
                "on:\n  workflow_run:", "on:\n  workflow_dispatch:\n  workflow_run:", 1))

    def test_neutral_packet_cannot_add_second_job(self):
        packet = (ROOT / ".github/workflows/prepare-neutral-audit-packet.yml").read_text()
        packet += "\n  unsafe_job:\n    runs-on: ubuntu-latest\n    steps: []\n"
        with self.assertRaisesRegex(ValueError, "unexpected or individually privileged job"):
            verify_bootstrap_wrappers(packet=packet)

    def test_neutral_packet_cannot_escalate_job_permissions(self):
        packet = (ROOT / ".github/workflows/prepare-neutral-audit-packet.yml").read_text()
        with self.assertRaisesRegex(ValueError, "unexpected or individually privileged job"):
            verify_bootstrap_wrappers(packet=packet.replace(
                "  packet:\n", "  packet:\n    permissions: write-all\n", 1))

    def test_neutral_packet_guard_cannot_accept_unverified_comment(self):
        packet = (ROOT / ".github/workflows/prepare-neutral-audit-packet.yml").read_text()
        with self.assertRaises(ValueError):
            verify_bootstrap_wrappers(packet=packet.replace(
                "github.event.comment.body == '/solverit-audit-packet'",
                "github.event.comment.body != '/solverit-audit-packet'", 1))

    def test_session_writer_rejects_duplicate_if_after_reviewed_guard(self):
        session = (ROOT / ".github/workflows/session-review.yml").read_text()
        # YAML parsers normally accept the last duplicate mapping key.
        with self.assertRaisesRegex(ValueError, "duplicate or alternative trusted job if"):
            verify_bootstrap_wrappers(session=session.replace(
                "    runs-on: ubuntu-latest", "    if: true\n    runs-on: ubuntu-latest", 1))

    def test_session_writer_rejects_extra_step_even_when_guard_is_unchanged(self):
        session = (ROOT / ".github/workflows/session-review.yml").read_text()
        step = "      - name: Unreviewed additional step\n        run: echo unreviewed\n"
        with self.assertRaisesRegex(ValueError, "content changed without explicit security review"):
            verify_bootstrap_wrappers(session=session.replace(
                "    steps:\n", "    steps:\n" + step, 1))

    def test_session_writer_rejects_untrusted_head_ref_checkout(self):
        session = (ROOT / ".github/workflows/session-review.yml").read_text()
        with self.assertRaises(ValueError):
            verify_bootstrap_wrappers(session=session.replace(
                "ref: ${{ github.workflow_sha }}",
                "ref: ${{ github.event.pull_request.head.ref }}", 1))

    def test_session_writer_rejects_unreviewed_command_change(self):
        session = (ROOT / ".github/workflows/session-review.yml").read_text()
        with self.assertRaisesRegex(ValueError, "content changed without explicit security review"):
            verify_bootstrap_wrappers(session=session.replace(
                "python .solverit-skill/scripts/verify_session_review.py --repo",
                "python .solverit-skill/scripts/verify_session_review.py --help && echo noop # --repo", 1))

    def test_neutral_packet_rejects_duplicate_if_after_reviewed_guard(self):
        packet = (ROOT / ".github/workflows/prepare-neutral-audit-packet.yml").read_text()
        with self.assertRaisesRegex(ValueError, "duplicate or alternative trusted job if"):
            verify_bootstrap_wrappers(packet=packet.replace(
                "    runs-on: ubuntu-latest", "    if: true\n    runs-on: ubuntu-latest", 1))

    def test_neutral_packet_rejects_unreviewed_additional_step(self):
        packet = (ROOT / ".github/workflows/prepare-neutral-audit-packet.yml").read_text()
        with self.assertRaisesRegex(ValueError, "content changed without explicit security review"):
            verify_bootstrap_wrappers(packet=packet.replace(
                "    steps:\n", "    steps:\n      - name: Extra\n        run: echo unreviewed\n", 1))

    def test_neutral_packet_rejects_untrusted_head_ref(self):
        packet = (ROOT / ".github/workflows/prepare-neutral-audit-packet.yml").read_text()
        with self.assertRaises(ValueError):
            verify_bootstrap_wrappers(packet=packet.replace(
                "ref: ${{ github.workflow_sha }}", "ref: ${{ github.event.pull_request.head.ref }}", 1))

    def test_neutral_packet_rejects_unreviewed_nested_permission(self):
        packet = (ROOT / ".github/workflows/prepare-neutral-audit-packet.yml").read_text()
        with self.assertRaisesRegex(ValueError, "content changed without explicit security review"):
            verify_bootstrap_wrappers(packet=packet.replace(
                "          persist-credentials: false", "          persist-credentials: false\n          submodules: true", 1))

    def test_duplicate_json_key(self):
        with self.assertRaises(ValueError):
            strict_json('{"mode":"disabled","mode":"enabled"}')


if __name__ == "__main__":
    unittest.main()
