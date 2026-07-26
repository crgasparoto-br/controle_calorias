#!/usr/bin/env python3
from __future__ import annotations

import base64
import gzip
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PARTS = ROOT / ".tmp" / "issue-880"


def git_blob_sha(content: bytes) -> str:
    header = f"blob {len(content)}\0".encode()
    return hashlib.sha1(header + content).hexdigest()


def payload(prefix: str) -> bytes:
    parts = sorted(PARTS.glob(f"{prefix}.*.part"))
    if not parts:
        raise SystemExit(f"missing payload parts for {prefix}")
    encoded = "".join(part.read_text().strip() for part in parts)
    return gzip.decompress(base64.b64decode(encoded))


def replace_verified(path: str, expected_blob: str | None, prefix: str) -> None:
    target = ROOT / path
    desired = payload(prefix)
    desired_blob = git_blob_sha(desired)
    if target.exists():
        current_blob = git_blob_sha(target.read_bytes())
        if current_blob == desired_blob:
            print(f"already current: {path}")
            return
        if expected_blob is None or current_blob != expected_blob:
            raise SystemExit(
                f"refusing to overwrite {path}: expected {expected_blob}, found {current_blob}"
            )
    elif expected_blob is not None:
        raise SystemExit(f"required source file is missing: {path}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(desired)
    print(f"updated {path}: {desired_blob}")


replace_verified(
    "client/src/pages/professional/ProfessionalPatientWorkspace.tsx",
    "2739cc62c7de14235af852b1ace1b66b4308fa79",
    "workspace",
)
replace_verified(
    "client/src/pages/professional/ProfessionalPatientWorkspace.auditCorrections.test.tsx",
    None,
    "test",
)
replace_verified(
    "docs/design-docs/professional-navigation.md",
    "f1383f16a64fa77b1fdbf44ab36fb7968b3bfea6",
    "docs",
)
