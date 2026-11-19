#!/usr/bin/env python3
"""Normalize the actual node:test JUnit emitter into strict JUnit suites.

The built-in Node reporter emits testcase elements directly under testsuites,
which the fail-closed shard merger correctly rejects. No cases or outcomes are
inferred, synthesized or promoted; all real testcase nodes are preserved.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import os
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


_ALLOWED_CASE_CHILDREN = {"failure", "error", "skipped", "system-out", "system-err"}


def normalize(source: Path, destination: Path) -> dict[str, int]:
    if not source.is_file() or source.is_symlink() or destination.is_symlink():
        raise ValueError("missing or unsafe node:test JUnit input/output")
    if ".." in destination.parts or not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
        raise ValueError("unsafe destination: no-follow directories are required")
    try:
        root = ET.parse(source).getroot()
    except ET.ParseError as exc:
        raise ValueError("invalid node:test JUnit XML") from exc
    if root.tag != "testsuites":
        raise ValueError("unexpected node:test JUnit root")
    if not list(root):
        raise ValueError("node:test JUnit did not execute any tests")
    seen: set[tuple[str, str]] = set()
    counts = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0}
    suite = ET.Element("testsuite", {"name": "node:test"})
    for case in list(root):
        if case.tag != "testcase":
            raise ValueError("unexpected node:test JUnit element")
        name, classname = case.get("name"), case.get("classname")
        if not name or not classname or (classname, name) in seen:
            raise ValueError("missing or duplicate node:test execution identity")
        seen.add((classname, name))
        outcomes = []
        for child in case:
            if child.tag not in _ALLOWED_CASE_CHILDREN or list(child):
                raise ValueError("unexpected nested node:test JUnit element")
            if child.tag in {"failure", "error", "skipped"}:
                outcomes.append(child.tag)
        if len(outcomes) > 1:
            raise ValueError("contradictory node:test execution outcomes")
        counts["tests"] += 1
        if outcomes:
            counts[{"failure": "failures", "error": "errors", "skipped": "skipped"}[outcomes[0]]] += 1
        suite.append(case)
    if counts["failures"] or counts["errors"]:
        raise ValueError("failing or errored node:test executions cannot be certified")
    if counts["tests"] == counts["skipped"]:
        raise ValueError("node:test JUnit has no executed non-skipped cases")
    for key, value in counts.items():
        suite.set(key, str(value))
    aggregate = ET.Element("testsuites", {key: str(value) for key, value in counts.items()})
    aggregate.append(suite)
    # Do not permit a symlink, including a broken symlink or a racing parent,
    # to redirect an evidence artifact outside its intended directory.
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    with ExitStack() as opened:
        parent_fd = os.open("/" if destination.is_absolute() else ".", flags)
        opened.callback(os.close, parent_fd)
        for component in destination.parent.parts:
            if component in {"/", "."}:
                continue
            try:
                os.mkdir(component, dir_fd=parent_fd)
            except FileExistsError:
                pass
            parent_fd = os.open(component, flags, dir_fd=parent_fd)
            opened.callback(os.close, parent_fd)
        fd = os.open(destination.name, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW,
                     0o644, dir_fd=parent_fd)
        with os.fdopen(fd, "wb") as handle:
            ET.ElementTree(aggregate).write(handle, encoding="utf-8", xml_declaration=True)
    return counts


def main() -> int:
    cli = argparse.ArgumentParser()
    cli.add_argument("--input", type=Path, required=True)
    cli.add_argument("--out", type=Path, required=True)
    args = cli.parse_args()
    try:
        result = normalize(args.input, args.out)
    except (ValueError, OSError) as exc:
        print(f"BLOCK: {exc}", file=sys.stderr)
        return 2
    print(f"node:test JUnit normalized: {result['tests']} real tests; semantic mapping still requires review")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
