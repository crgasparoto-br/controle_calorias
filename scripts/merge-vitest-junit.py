#!/usr/bin/env python3
"""Merge real, exact-run Vitest JUnit shards without inventing test outcomes.

This only consolidates executed test cases. It is never a semantic certification.
"""
from __future__ import annotations

import argparse
from collections import Counter
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def merge(directory: Path, destination: Path, shards: int = 24) -> dict[str, int]:
    if shards < 1 or shards > 256:
        raise ValueError("invalid shard count")
    if not directory.is_dir() or directory.is_symlink():
        raise ValueError("JUnit shard directory is missing or unsafe")
    if destination.exists() and destination.is_symlink():
        raise ValueError("JUnit destination cannot be a symlink")

    aggregate = ET.Element("testsuites")
    observed: set[tuple[str, str]] = set()
    raw_shards: dict[tuple[str, str], int] = {}

    def verify_counts(node: ET.Element, actual: dict[str, int], location: str) -> None:
        for key, expected in actual.items():
            declared = node.get(key)
            if declared is not None and (not declared.isdecimal() or int(declared) != expected):
                raise ValueError(f"inconsistent JUnit {key} count in {location}")
    counts = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0}
    for number in range(1, shards + 1):
        source = directory / f"shard-{number}.xml"
        if not source.is_file() or source.is_symlink():
            raise ValueError(f"missing or unsafe exact-run JUnit shard: {number}/{shards}")
        try:
            root = ET.parse(source).getroot()
        except ET.ParseError as exc:
            raise ValueError(f"invalid JUnit XML in shard {number}") from exc
        if root.tag == "testsuite":
            suites = [root]
        elif root.tag == "testsuites":
            suites = root.findall("testsuite")
        else:
            raise ValueError(f"unsupported JUnit root in shard {number}: {root.tag}")
        if not suites:
            raise ValueError(f"JUnit shard {number} contains no testsuites")
        # Vitest test.each can emit multiple executed cases with the same
        # reporter name. The index requires a unique classname::name pair;
        # suffix same-shard occurrences while retaining raw name in evidence.
        # Never coalesce or accept duplicates crossing shard boundaries.
        raw_counts = Counter((case.get("classname"), case.get("name"))
                             for case in root.iter("testcase"))
        occurrences: Counter[tuple[str, str]] = Counter()
        shard_cases = 0
        shard_counts = {key: 0 for key in counts}
        for suite in suites:
            if suite.find("testsuite") is not None:
                raise ValueError(f"nested JUnit suites are unsupported in shard {number}")
            cases = suite.findall("testcase")
            suite_counts = {key: 0 for key in counts}
            shard_cases += len(cases)
            if not cases:
                continue
            for case in cases:
                name = case.get("name", "").strip()
                classname = case.get("classname", "").strip()
                if not name or not classname:
                    raise ValueError(f"JUnit test identity incomplete in shard {number}")
                original = (classname, name)
                previous_shard = raw_shards.get(original)
                if previous_shard is not None and previous_shard != number:
                    raise ValueError(f"duplicate test across JUnit shards: {classname}::{name}")
                raw_shards[original] = number
                occurrences[original] += 1
                if raw_counts[original] > 1:
                    # Source executions, not synthesized tests. Ordinals
                    # are reproducible from the exact original JUnit bytes.
                    case.set("audit_original_name", name)
                    name = f"{name} [JUnit occurrence {occurrences[original]}/{raw_counts[original]}]"
                    case.set("name", name)
                identity = (classname, name)
                if identity in observed:
                    raise ValueError(f"ambiguous merged JUnit test identity: {classname}::{name}")
                observed.add(identity)
                suite_counts["tests"] += 1
                outcomes = [event for event in ("failure", "error", "skipped") if case.find(event) is not None]
                if len(outcomes) > 1:
                    raise ValueError(f"contradictory JUnit testcase outcomes in shard {number}")
                if outcomes:
                    suite_counts[{"failure": "failures", "error": "errors", "skipped": "skipped"}[outcomes[0]]] += 1
            verify_counts(suite, suite_counts, f"shard {number} suite")
            for key in counts:
                counts[key] += suite_counts[key]
                shard_counts[key] += suite_counts[key]
            aggregate.append(suite)
        if root.tag == "testsuites":
            verify_counts(root, shard_counts, f"shard {number} root")
        if shard_cases == 0:
            raise ValueError(f"JUnit shard {number} has no executed or skipped tests")
    if counts["failures"] or counts["errors"]:
        raise ValueError("JUnit contains failing or errored testcases")
    if counts["tests"] == counts["skipped"]:
        raise ValueError("JUnit contains no executed non-skipped testcases")
    for key, value in counts.items():
        aggregate.set(key, str(value))
    destination.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(aggregate).write(destination, encoding="utf-8", xml_declaration=True)
    return counts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", dest="directory", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--shards", type=int, default=24)
    arguments = parser.parse_args()
    try:
        counts = merge(arguments.directory, arguments.out, arguments.shards)
    except (ValueError, OSError) as exc:
        print(f"BLOCK: {exc}", file=sys.stderr)
        return 2
    print(f"JUnit merged: {counts['tests']} cases, {counts['skipped']} skipped; semantic review still required")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
