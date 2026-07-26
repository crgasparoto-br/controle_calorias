#!/usr/bin/env python3
from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "client/src/pages/professional/ProfessionalPatientWorkspace.auditCorrections.test.tsx"
EXPECTED_BLOB = "8aa66014c2f30a05355db829ba1a98dcc07fb4d8"


def blob(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


data = TARGET.read_bytes()
current = blob(data)
if current != EXPECTED_BLOB:
    raise SystemExit(f"refusing to patch test: expected {EXPECTED_BLOB}, found {current}")
text = data.decode()
replacements = [
    ("const mutation = () => ({\n", "const mutation = vi.hoisted(() => () => ({\n"),
    ("  error: null,\n});\n\nvi.mock(\"wouter\"", "  error: null,\n}));\n\nvi.mock(\"wouter\""),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one occurrence, found {count}: {old!r}")
    text = text.replace(old, new, 1)
TARGET.write_text(text)
print(f"updated test blob: {blob(TARGET.read_bytes())}")
