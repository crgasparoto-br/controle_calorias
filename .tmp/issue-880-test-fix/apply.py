#!/usr/bin/env python3
from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "client/src/pages/professional/ProfessionalPatientWorkspace.tsx"
EXPECTED_BLOB = "a16cad8de85cf3c58a2b618ac95b0f89917a628b"


def git_blob_sha(content: bytes) -> str:
    return hashlib.sha1(f"blob {len(content)}\0".encode() + content).hexdigest()


content = TARGET.read_bytes()
current_blob = git_blob_sha(content)
if current_blob != EXPECTED_BLOB:
    raise SystemExit(
        f"refusing to patch workspace: expected {EXPECTED_BLOB}, found {current_blob}"
    )

text = content.decode()
needle = """function RecordCollectionPagination({
  label,
  onPageChange,
  page,
  total,
}: {
"""
helper = """function recordCollectionTotal(input: {
  total: unknown;
  visibleCount: number;
  page: number;
  hasMore?: boolean;
}) {
  if (
    typeof input.total === \"number\" &&
    Number.isFinite(input.total) &&
    input.total >= 0
  ) {
    return input.total;
  }
  return (
    (input.page - 1) * RECORD_PAGE_SIZE +
    input.visibleCount +
    (input.hasMore ? 1 : 0)
  );
}

function RecordCollectionPagination({
  label,
  onPageChange,
  page,
  total,
}: {
"""
replacements = {
    needle: helper,
    "total={record.pagination.totals.assessments}": """total={recordCollectionTotal({
                total: record.pagination?.totals?.assessments,
                visibleCount: record.assessmentHistory.length,
                page,
              })}""",
    "total={record.pagination.totals.guidances}": """total={recordCollectionTotal({
                total: record.pagination?.totals?.guidances,
                visibleCount: record.guidances.length,
                page,
              })}""",
    "total={record.pagination.totals.notes}": """total={recordCollectionTotal({
                total: record.pagination?.totals?.notes,
                visibleCount: record.notes.length,
                page,
              })}""",
    "total={record.pagination.totals.timeline}": """total={recordCollectionTotal({
            total: record.pagination?.totals?.timeline,
            visibleCount: record.timeline.length,
            page,
            hasMore: Boolean(record.pagination?.hasMore),
          })}""",
}
for old, new in replacements.items():
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one occurrence, found {count}: {old[:80]!r}")
    text = text.replace(old, new, 1)
TARGET.write_text(text)
print(f"updated workspace blob: {git_blob_sha(TARGET.read_bytes())}")
