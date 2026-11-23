"""M1-04 contract-evidence parser and same-head PR separation controls.

Simulated input is deliberately not described as a real GitHub integration run.
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import verify_session_m1_controls as gate
import verify_session_review as reviewer
from session_review import review_snapshot

HEAD = "a" * 40
REPO = "crgasparoto-br/controle_calorias"


def junit(path: Path, cases: list[tuple[str, str, str]]) -> None:
    root = ElementTree.Element("testsuites")
    suite = ElementTree.SubElement(root, "testsuite", tests=str(len(cases)))
    for module, name, outcome in cases:
        node = ElementTree.SubElement(suite, "testcase", classname=module, name=name)
        if outcome != "passed":
            ElementTree.SubElement(node, outcome)
    path.write_bytes(ElementTree.tostring(root))


def sample_cases(kind: str) -> list[tuple[str, str, str]]:
    rows = []
    for scenario, (source, module, name) in gate.SCENARIOS.items():
        if source == kind:
            count = gate.EXPECTED_COUNTS[scenario]
            rows.extend((module, name + (f"[variant-{i}]" if count > 1 else ""), "passed")
                        for i in range(count))
    return rows


class SessionM1ExecutedMatrixTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        directory = Path(self.tmp.name)
        self.official = directory / "official.xml"
        self.candidate = directory / "candidate.xml"
        junit(self.official, sample_cases("official"))
        junit(self.candidate, sample_cases("candidate"))

    def test_matrix_positive_with_distinct_real_test_ids(self):
        result = gate.validate(self.official, self.candidate, HEAD)
        self.assertEqual(len(result["scenario_controls"]), 11)
        self.assertEqual(result["live_github_adversarial_proof"], "NOT_ASSERTED")
        self.assertEqual(result["semantic_certification"], "NOT_ASSERTED")

    def test_matrix_missing_control_fails_closed(self):
        junit(self.official, sample_cases("official")[:-1])
        with self.assertRaisesRegex(ValueError, "untrusted-workflow"):
            gate.validate(self.official, self.candidate, HEAD)

    def test_matrix_recognizes_actual_nested_candidate_checkout(self):
        rows = sample_cases("candidate")
        qualified = [(".candidate." + module + ".SessionM1ExecutedMatrixTests", name, status)
                     for module, name, status in rows]
        junit(self.candidate, qualified)
        self.assertEqual(len(gate.validate(self.official, self.candidate, HEAD)["scenario_controls"]), 11)

    def test_matrix_rejects_foreign_candidate_module(self):
        rows = sample_cases("candidate")
        junit(self.candidate, [("untrusted.fake_session", name, result) for _, name, result in rows])
        with self.assertRaisesRegex(ValueError, "two-pr-same-head"):
            gate.validate(self.official, self.candidate, HEAD)

    def test_matrix_skipped_control_fails_closed(self):
        rows = sample_cases("official")
        rows[0] = (rows[0][0], rows[0][1], "skipped")
        junit(self.official, rows)
        with self.assertRaisesRegex(ValueError, "review-positive"):
            gate.validate(self.official, self.candidate, HEAD)

    def test_matrix_failed_control_fails_closed(self):
        rows = sample_cases("candidate")
        rows[0] = (rows[0][0], rows[0][1], "failure")
        junit(self.candidate, rows)
        with self.assertRaisesRegex(ValueError, "two-pr-same-head"):
            gate.validate(self.official, self.candidate, HEAD)

    def test_matrix_rejects_duplicated_test_case(self):
        rows = sample_cases("official")
        junit(self.official, rows + [rows[0]])
        with self.assertRaisesRegex(ValueError, "repeated executed JUnit"):
            gate.validate(self.official, self.candidate, HEAD)

    def test_matrix_rejects_invalid_sha_and_doctype(self):
        with self.assertRaisesRegex(ValueError, "non-exact"):
            gate.validate(self.official, self.candidate, "not-a-sha")
        self.official.write_bytes(b'<!DOCTYPE testsuites [<!ENTITY x "y">]><testsuites/>')
        with self.assertRaisesRegex(ValueError, "DTD/entities"):
            gate.validate(self.official, self.candidate, HEAD)

    def test_same_head_pr_reviews_are_separate(self):
        # Two *different* open PRs can share a material commit. Neither the
        # target enumeration nor an immutable review URL may collapse by SHA.
        def api(path):
            number = int(path.rsplit("/", 1)[1])
            self.assertIn(number, (1348, 1401))
            issue = 1345 if number == 1348 else 1400
            return {"number": number, "state": "open", "draft": False,
                    "base": {"ref": "develop"}, "head": {"sha": HEAD},
                    "body": f"Refs #{issue}"}

        event = {"repository": {"full_name": REPO},
                 "workflow_run": {"event": "pull_request", "head_sha": HEAD,
                                  "pull_requests": [{"number": 1348}, {"number": 1401}]}}
        with patch.object(reviewer, "api", side_effect=api):
            self.assertEqual(reviewer.resolve_targets(REPO, event), [(1348, 1345), (1401, 1400)])
        comment = {"id": 99, "body": "SOLVERIT_SESSION_REVIEW_V1:{}",
                   "user": {"id": 255721831, "login": "crgasparoto-br", "type": "User"},
                   "url": f"https://api.github.com/repos/{REPO}/issues/comments/99",
                   "issue_url": f"https://api.github.com/repos/{REPO}/issues/1348",
                   "created_at": "2026-11-23T12:00:00Z", "updated_at": "2026-11-23T12:00:00Z"}
        self.assertEqual(review_snapshot(comment, REPO, 1348)["id"], 99)
        with self.assertRaisesRegex(ValueError, "authenticated PR"):
            review_snapshot(comment, REPO, 1401)


if __name__ == "__main__":
    unittest.main()
