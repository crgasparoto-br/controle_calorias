"""Adversarial and positive M1 bootstrap tests (#1345)."""
import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from operator_session_preflight import strict_json, validate  # noqa: E402


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

    def test_duplicate_json_key(self):
        with self.assertRaises(ValueError):
            strict_json('{"mode":"disabled","mode":"enabled"}')


if __name__ == "__main__":
    unittest.main()
