#!/usr/bin/env python3
from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKSPACE = ROOT / "client/src/pages/professional/ProfessionalPatientWorkspace.tsx"
TEST = ROOT / "client/src/pages/professional/ProfessionalPatientWorkspace.auditCorrections.test.tsx"
EXPECTED_WORKSPACE = "1dd81d3328180f0f8f5bc6e5dcfca8cd1f266d2b"
EXPECTED_TEST = "833fe92c72f65973d5e5fd1ea019b14a1edeb9ff"


def blob(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def patch(path: Path, expected: str, replacements: list[tuple[str, str]]) -> None:
    data = path.read_bytes()
    current = blob(data)
    if current != expected:
        raise SystemExit(f"refusing to patch {path}: expected {expected}, found {current}")
    text = data.decode()
    for old, new in replacements:
        count = text.count(old)
        if count != 1:
            raise SystemExit(f"expected one occurrence in {path}, found {count}: {old[:100]!r}")
        text = text.replace(old, new, 1)
    path.write_text(text)
    print(f"updated {path}: {blob(path.read_bytes())}")


patch(
    WORKSPACE,
    EXPECTED_WORKSPACE,
    [
        (
            """function RecordCollectionPagination({
  label,
  onPageChange,
  page,
  total,
}: {
  label: string;
  onPageChange: (page: number) => void;
  page: number;
  total: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / RECORD_PAGE_SIZE));
  if (totalPages <= 1 && page <= 1) return null;
""",
            """function RecordCollectionPagination({
  alwaysVisible = false,
  label,
  onPageChange,
  page,
  total,
}: {
  alwaysVisible?: boolean;
  label: string;
  onPageChange: (page: number) => void;
  page: number;
  total: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / RECORD_PAGE_SIZE));
  if (!alwaysVisible && totalPages <= 1 && page <= 1) return null;
""",
        ),
        (
            """        <RecordCollectionPagination
          label="histórico"
          page={page}
""",
            """        <RecordCollectionPagination
          alwaysVisible
          label="histórico"
          page={page}
""",
        ),
    ],
)
patch(
    TEST,
    EXPECTED_TEST,
    [
        (
            """    expect(screen.getByText("Situação do acompanhamento alterada")).toBeTruthy();
    expect(screen.queryByText("official_goal_revised")).toBeNull();
""",
            """    expect(screen.getByText("Situação do acompanhamento alterada")).toBeTruthy();
    expect(
      screen.getByRole("navigation", { name: "Paginação de histórico" })
    ).toBeTruthy();
    expect(screen.getByText("Página 1 de 1")).toBeTruthy();
    expect(screen.queryByText("official_goal_revised")).toBeNull();
""",
        )
    ],
)
