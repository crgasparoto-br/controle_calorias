#!/usr/bin/env python3
"""Merge real, exact-run Vitest JUnit shards without inventing test outcomes.

This only consolidates executed test cases. It is never a semantic certification.
"""
from __future__ import annotations

import argparse
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
        shard_cases = 0
        for suite in suites:
            cases = list(suite.iter("testcase"))
            shard_cases += len(cases)
            if not cases:
                continue
            for case in cases:
                name = case.get("name", "").strip()
                classname = case.get("classname", "").strip()
                if not name or not classname:
                    raise ValueError(f"JUnit test identity incomplete in shard {number}")
                identity = (classname, name)
                if identity in observed:
                    raise ValueError(f"duplicate test across JUnit shards: {classname}::{name}")
                observed.add(identity)
                counts["tests"] += 1
                for event in ("failure", "error", "skipped"):
                    if case.find(event) is not None:
                        counts[{"failure": "failures", "error": "errors", "skipped": "skipped"}[event]] += 1
            aggregate.append(suite)
        if shard_cases == 0:
            raise ValueError(f"JUnit shard {number} has no executed or skipped tests")
    if counts["failures"] or counts["errors"]:
        raise ValueError("JUnit contains failing or errored testcases")
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
