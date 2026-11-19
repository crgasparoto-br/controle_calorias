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

    def assert_blocked(self, *, integration=None, policy=None, workflow=None):
        with self.assertRaises(ValueError):
            validate(integration if integration is not None else self.integration,
                     policy if policy is not None else self.policy,
                     workflow if workflow is not None else self.workflow)

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
            "  contents: read", "  contents: read\\n  checks: write"))

    def test_elevated_pr_event(self):
        self.assert_blocked(workflow=self.workflow.replace(
            "  pull_request:", "  pull_request_target:"))

    def test_missing_tests(self):
        self.assert_blocked(workflow=self.workflow.replace(
            "python -m unittest discover", "python -m other discover"))

    def test_duplicate_json_key(self):
        with self.assertRaises(ValueError):
            strict_json('{"mode":"disabled","mode":"enabled"}')


if __name__ == "__main__":
    unittest.main()
