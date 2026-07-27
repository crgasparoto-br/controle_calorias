from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one match in {path}, found {count}: {old[:160]!r}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "visual-tests/professional-patient-workspace/trpcMock.ts",
    '''function patientContextQuery(input: { patientId: number }) {
  return querySuccess({
    patientId: input.patientId,
    displayName: "Mariana de Almeida Vasconcelos e Silva",
    authorizationStatus: "approved" as const,
    lastActivityAt: now - 45 * 60_000,
    nextReviewAt: now + 12 * 86_400_000,
    trackingStatus: trackingStatusForState(),
  });
}
''',
    '''function patientContextQuery(input: { patientId: number }) {
  const trackingStatus = trackingStatusForState();
  return querySuccess({
    patientId: input.patientId,
    authorizationId:
      trackingStatus === "ended" ? undefined : "authorization-visual-1",
    displayName: "Mariana de Almeida Vasconcelos e Silva",
    authorizationStatus: "approved" as const,
    lastActivityAt: now - 45 * 60_000,
    nextReviewAt: now + 12 * 86_400_000,
    trackingStatus,
  });
}
''',
)

replace_once(
    "docs/testing/professional-workspace-routing.md",
    '''O harness usa `ProfessionalAreaPage`, `ProfessionalLayout` e `ProfessionalPatientWorkspace` reais, substituindo somente autenticação e transporte tRPC por fixtures determinísticas. Ele comprova composição, responsividade e estados visuais; autorização, persistência e contratos de backend permanecem cobertos pelos gates funcionais próprios.
''',
    '''O harness usa `ProfessionalAreaPage`, `ProfessionalLayout` e `ProfessionalPatientWorkspace` reais, substituindo somente autenticação e transporte tRPC por fixtures determinísticas. Os estados ativo e pausado fornecem o mesmo `authorizationId`, reproduzindo um único ciclo de acompanhamento; o estado encerrado respeita o contrato público mínimo sem esse identificador. Ele comprova composição, responsividade e estados visuais; autorização, persistência e contratos de backend permanecem cobertos pelos gates funcionais próprios.
''',
)

print("Visual patient context aligned with the canonical authorization lifecycle")
