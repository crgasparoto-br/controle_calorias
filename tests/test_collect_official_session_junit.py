"""Fail-closed controls for the pinned official session JUnit collection (#1345).

These are runner-orchestration tests, not substitute evidence for execution of
upstream reviewer suites. The real official suites run in the handoff workflow.
"""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
COLLECTOR = ROOT / "scripts/collect-solverit-certification-tests.sh"
OFFICIAL_SUITES = (
    "test_session_review.py",
    "test_session_review_dossier.py",
    "test_session_review_runner.py",
    "test_session_review_workflows.py",
    "test_session_certificate_event.py",
    "test_plan_session_ruleset_m2.py",
)


class OfficialSessionJUnitCollectionTests(unittest.TestCase):
    def test_requires_trusted_checkout_before_modifying_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / "pytest-exact-head.xml"
            original.write_text("preflight JUnit must survive rejected setup", encoding="utf-8")
            env = {**os.environ, "EVIDENCE_DIR": str(root)}
            env.pop("HANDOFF_TOOLING", None)
            result = subprocess.run(["bash", str(COLLECTOR)], cwd=ROOT, env=env,
                                    capture_output=True, text=True, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(original.read_text(encoding="utf-8"),
                             "preflight JUnit must survive rejected setup")
            self.assertFalse((root / "junit-shards").exists())

    def test_missing_upstream_tests_block_collection_before_evidence_move(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / "pytest-exact-head.xml"
            original.write_text("original", encoding="utf-8")
            checkout = root / "missing-suites"
            checkout.mkdir()
            env = {**os.environ, "EVIDENCE_DIR": str(root), "HANDOFF_TOOLING": str(checkout)}
            result = subprocess.run(["bash", str(COLLECTOR)], cwd=ROOT, env=env,
                                    capture_output=True, text=True, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(original.read_text(encoding="utf-8"), "original")
            self.assertFalse((root / "junit-shards").exists())

    def test_incomplete_official_suite_inventory_is_rejected_before_junit_move(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / "pytest-exact-head.xml"
            original.write_text("original", encoding="utf-8")
            checkout = root / "partial-checkout"
            tests = checkout / "tests"
            tests.mkdir(parents=True)
            for name in OFFICIAL_SUITES[:-1]:
                (tests / name).write_text("def test_present(): pass\n", encoding="utf-8")
            env = {**os.environ, "EVIDENCE_DIR": str(root), "HANDOFF_TOOLING": str(checkout)}
            result = subprocess.run(["bash", str(COLLECTOR)], cwd=ROOT, env=env,
                                    capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 2)
            self.assertIn(OFFICIAL_SUITES[-1], result.stderr)
            self.assertEqual(original.read_text(encoding="utf-8"), "original")
            self.assertFalse((root / "junit-shards").exists())

    def test_symlinked_official_suite_is_rejected_before_junit_move(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / "pytest-exact-head.xml"
            original.write_text("original", encoding="utf-8")
            tests = root / "trusted-checkout" / "tests"
            tests.mkdir(parents=True)
            for name in OFFICIAL_SUITES:
                (tests / name).write_text("def test_present(): pass\n", encoding="utf-8")
            (tests / OFFICIAL_SUITES[0]).unlink()
            (tests / OFFICIAL_SUITES[0]).symlink_to(tests / OFFICIAL_SUITES[1])
            env = {**os.environ, "EVIDENCE_DIR": str(root), "HANDOFF_TOOLING": str(tests.parent)}
            result = subprocess.run(["bash", str(COLLECTOR)], cwd=ROOT, env=env,
                                    capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 2)
            self.assertIn(OFFICIAL_SUITES[0], result.stderr)
            self.assertEqual(original.read_text(encoding="utf-8"), "original")
            self.assertFalse((root / "junit-shards").exists())

    def test_six_pinned_suites_are_mandatory_and_aggregated_as_27th_shard(self):
        script = COLLECTOR.read_text(encoding="utf-8")
        self.assertIn("HANDOFF_TOOLING must be the trusted", script)
        self.assertIn('cd -- "$HANDOFF_TOOLING"', script)
        self.assertIn('"$shards/shard-27.xml"', script)
        self.assertIn('--shards 27', script)
        self.assertNotIn('|| true', script)
        self.assertIn('set -euo pipefail', script)
        for suite in OFFICIAL_SUITES:
            self.assertIn('tests/' + suite, script)


if __name__ == "__main__":
    unittest.main()
