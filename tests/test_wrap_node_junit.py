"""Positive and adversarial validation of authentic node:test JUnit conversion."""
from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import xml.etree.ElementTree as ET

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "wrap-node-junit.py"
spec = importlib.util.spec_from_file_location("wrap_node_junit", SCRIPT)
assert spec and spec.loader
normalizer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(normalizer)


def node(*cases: str) -> str:
    return "<testsuites>" + "".join(cases) + "</testsuites>"


def case(name: str, body: str = "") -> str:
    return f'<testcase classname="test" name="{name}" time="0.01">{body}</testcase>'


class NodeTestJunitContractTests(unittest.TestCase):
    def setUp(self):
        self.folder = TemporaryDirectory(prefix="solverit-junit-")
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)

    def check(self, content: str, destination: Path | None = None) -> tuple[dict, ET.Element]:
        raw = self.root / "raw.xml"
        raw.write_text(content, encoding="utf-8")
        output = destination or self.root / "shards" / "shard-26.xml"
        count = normalizer.normalize(raw, output)
        return count, ET.parse(output).getroot()

    def test_positive_real_cases_preserve_identity_and_count(self):
        count, root = self.check(node(case("success"), case("another")))
        self.assertEqual(count, {"tests": 2, "failures": 0, "errors": 0, "skipped": 0})
        self.assertEqual(root.tag, "testsuites")
        self.assertEqual(root.get("tests"), "2")
        self.assertEqual([t.get("name") for t in root.findall("./testsuite/testcase")],
                         ["success", "another"])

    def test_regression_skipped_remains_skipped(self):
        count, root = self.check(node(case("pass"), case("skip", "<skipped/>")))
        self.assertEqual(count["skipped"], 1)
        self.assertIsNotNone(root.findall("./testsuite/testcase")[1].find("skipped"))

    def test_negative_invalid_empty_or_unknown_xml(self):
        for source in ("<testsuites>", "<testsuite/>", "<other/>", "<testsuites/>"):
            with self.assertRaises(ValueError):
                self.check(source)

    def test_negative_duplicate_and_missing_identifiers(self):
        for source in (node(case("duplicate"), case("duplicate")), node('<testcase name="missing-class"/>')):
            with self.assertRaises(ValueError):
                self.check(source)

    def test_negative_nested_or_unexpected_suite_elements(self):
        for source in (node(case("alone"), "<testsuite/>") ,
                       node(case("alone", "<metadata><failure/></metadata>"))):
            with self.assertRaises(ValueError):
                self.check(source)

    def test_negative_failures_errors_and_contradictory_outcomes(self):
        for source in (node(case("alone", "<failure/><skipped/>")),
                       node(case("alone", "<failure message='bad'/>")),
                       node(case("alone", "<error message='bad'/>")),
                       node(case("only-skipped", "<skipped/>"))):
            with self.assertRaises(ValueError):
                self.check(source)

    def test_positive_consistent_root_counts_are_preserved(self):
        source = ('<testsuites tests="2" failures="0" errors="0" skipped="1">'
                  + case("pass") + case("skip", "<skipped/>") + '</testsuites>')
        count, root = self.check(source)
        self.assertEqual(count, {"tests": 2, "failures": 0, "errors": 0, "skipped": 1})
        self.assertEqual({key: root.get(key) for key in count},
                         {"tests": "2", "failures": "0", "errors": "0", "skipped": "1"})

    def test_negative_inconsistent_root_counts_fail_closed(self):
        # A-004: never normalize claimed failing or incorrectly counted JUnit into a pass.
        cases = case("pass") + case("skip", "<skipped/>")
        for attribute, wrong_value in (("tests", "3"), ("failures", "1"),
                                       ("errors", "1"), ("skipped", "0")):
            with self.subTest(attribute=attribute):
                source = f'<testsuites {attribute}="{wrong_value}">{cases}</testsuites>'
                output = self.root / f"rejected-{attribute}.xml"
                with self.assertRaisesRegex(ValueError, f"inconsistent node:test JUnit {attribute} count"):
                    self.check(source, output)
                self.assertFalse(output.exists(), "a rejected result must not create evidence")

    def test_negative_invalid_root_count_encoding(self):
        for declared in ("", "-1", "1.0", "unknown", " 1", "1 "):
            with self.subTest(declared=declared):
                source = f'<testsuites tests="{declared}">{case("pass")}</testsuites>'
                with self.assertRaisesRegex(ValueError, "inconsistent node:test JUnit tests count"):
                    self.check(source)

    def test_cli_rejects_claimed_failure_without_output(self):
        # Public CLI contract must return 2, matching certification fail-closed semantics.
        raw = self.root / "claimed-failure.xml"
        raw.write_text(f'<testsuites tests="1" failures="1">{case("pass")}</testsuites>',
                       encoding="utf-8")
        output = self.root / "shard-26.xml"
        result = subprocess.run([sys.executable, str(SCRIPT), "--input", str(raw), "--out", str(output)],
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("BLOCK: inconsistent node:test JUnit failures count", result.stderr)
        self.assertFalse(output.exists())

    def test_negative_dangling_output_symlink(self):
        output = self.root / "link.xml"
        output.symlink_to(self.root / "outside.xml")
        with self.assertRaisesRegex(ValueError, "unsafe"):
            self.check(node(case("valid")), output)
        self.assertFalse((self.root / "outside.xml").exists())

    def test_negative_parent_symlink(self):
        target = self.root / "real-parent"
        target.mkdir()
        (self.root / "link").symlink_to(target, target_is_directory=True)
        with self.assertRaises(OSError):
            self.check(node(case("valid")), self.root / "link" / "output.xml")
        self.assertFalse((target / "output.xml").exists())

    def test_negative_input_symlink(self):
        raw = self.root / "source.xml"
        raw.write_text(node(case("valid")), encoding="utf-8")
        alias = self.root / "alias.xml"
        alias.symlink_to(raw)
        with self.assertRaisesRegex(ValueError, "unsafe"):
            normalizer.normalize(alias, self.root / "result.xml")


if __name__ == "__main__":
    unittest.main()
