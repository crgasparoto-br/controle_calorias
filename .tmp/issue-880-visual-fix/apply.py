#!/usr/bin/env python3
from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "client/src/pages/professional/ProfessionalPatientWorkspace.tsx"
DOC = ROOT / "docs/design-docs/professional-navigation.md"
EXPECTED_TARGET_BLOB = "b9b5da71632a6278a37c13ea4ee792281cbc57c7"
EXPECTED_DOC_BLOB = "c98b16a2b101f6e0f621dfbce8eab96f2d4b227e"


def git_blob_sha(content: bytes) -> str:
    return hashlib.sha1(f"blob {len(content)}\0".encode() + content).hexdigest()


def replace_once(path: Path, expected_blob: str, replacements: list[tuple[str, str]]) -> None:
    content = path.read_bytes()
    current_blob = git_blob_sha(content)
    if current_blob != expected_blob:
        raise SystemExit(
            f"refusing to patch {path}: expected {expected_blob}, found {current_blob}"
        )
    text = content.decode()
    for old, new in replacements:
        count = text.count(old)
        if count != 1:
            raise SystemExit(f"expected one occurrence in {path}, found {count}: {old[:80]!r}")
        text = text.replace(old, new, 1)
    path.write_text(text)
    print(f"updated {path}: {git_blob_sha(path.read_bytes())}")


replace_once(
    TARGET,
    EXPECTED_TARGET_BLOB,
    [
        (
            "  const allowNavigationRef = useRef(false);\n",
            "  const allowNavigationRef = useRef(false);\n  const restoringHistoryRef = useRef(false);\n",
        ),
        (
            """    const guardBack = () => {
      if (!dirty || allowNavigationRef.current) return;
      if (!window.confirm(UNSAVED_MESSAGE)) {
        window.history.pushState(
          { professionalDraftGuard: true },
          "",
          currentPath
        );
      } else {
""",
            """    const guardBack = () => {
      if (restoringHistoryRef.current) {
        restoringHistoryRef.current = false;
        return;
      }
      if (!dirty || allowNavigationRef.current) return;
      if (!window.confirm(UNSAVED_MESSAGE)) {
        const restorationState = { professionalDraftGuard: true };
        restoringHistoryRef.current = true;
        window.history.pushState(restorationState, "", currentPath);
        window.dispatchEvent(
          new PopStateEvent("popstate", { state: restorationState })
        );
      } else {
""",
        ),
    ],
)
replace_once(
    DOC,
    EXPECTED_DOC_BLOB,
    [
        (
            "Em navegadores sem Navigation API, um `popstate` cancelado pode remontar a rota sem perder o conteúdo;",
            "Em navegadores sem Navigation API, um `popstate` cancelado restaura a URL e sincroniza novamente o roteador antes de remontar a rota, sem perder o conteúdo;",
        )
    ],
)
