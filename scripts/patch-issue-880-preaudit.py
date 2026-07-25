from pathlib import Path
import re


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def patch_workspace() -> None:
    path = Path("client/src/pages/professional/ProfessionalPatientWorkspace.tsx")
    source = path.read_text(encoding="utf-8")

    if "const historyEventLabels" not in source:
        helper = '''
const historyEventLabels: Record<string, string> = {
  access_requested: "Acesso profissional solicitado",
  access_approved: "Acesso profissional aprovado",
  access_rejected: "Acesso profissional recusado",
  access_revoked: "Acesso profissional revogado",
  access_authorization_whatsapp_sent: "Autorização enviada pelo WhatsApp",
  access_authorization_whatsapp_failed: "Falha ao enviar autorização pelo WhatsApp",
  tracking_started: "Acompanhamento iniciado",
  tracking_resumed: "Acompanhamento retomado",
  tracking_paused: "Acompanhamento pausado",
  tracking_ended: "Acompanhamento encerrado",
  tracking_status_changed: "Situação do acompanhamento alterada",
  assessment_version_created: "Nova versão da avaliação registrada",
  private_note_created: "Anotação privada registrada",
  guidance_created: "Orientação ao paciente registrada",
  official_goal_activated: "Meta oficial ativada",
  official_goal_notification_sent: "Notificação da meta enviada",
  official_goal_notification_failed: "Falha na notificação da meta",
  professional_message_created: "Mensagem profissional registrada",
  professional_message_sent: "Mensagem profissional enviada",
  professional_message_failed: "Falha no envio da mensagem profissional",
  professional_message_received: "Mensagem do paciente recebida",
};

function historyEventLabel(item: {
  label?: string | null;
  eventType?: string | null;
}) {
  if (item.label?.trim()) return item.label;
  if (item.eventType && historyEventLabels[item.eventType]) {
    return historyEventLabels[item.eventType];
  }
  return "Evento profissional registrado";
}
'''
        marker = "\ntype AssessmentDraft = {"
        require(marker in source, "AssessmentDraft marker not found")
        source = source.replace(marker, helper + marker, 1)

    old_assessment = '<p className="mt-2 text-xs">{formatDate(item.assessedAt)}</p>'
    if old_assessment in source:
        source = source.replace(
            old_assessment,
            '''<p className="mt-2 text-xs text-muted-foreground">
                    {item.authorName ?? "Autoria não informada"} · {formatDate(item.assessedAt)}
                  </p>''',
            1,
        )

    notes_start = source.index("function NotesSection(")
    notes_end = source.index("function HistorySection(", notes_start)
    notes = source[notes_start:notes_end]
    old_note = '''<p className="mt-2 text-xs text-muted-foreground">
                    {formatDate(item.createdAt)}
                  </p>'''
    if old_note in notes:
        notes = notes.replace(
            old_note,
            '''<p className="mt-2 text-xs text-muted-foreground">
                    {item.authorName ?? "Autoria não informada"} · {formatDate(item.createdAt)}
                  </p>''',
            1,
        )
    source = source[:notes_start] + notes + source[notes_end:]
    source = source.replace("{item.label ?? item.eventType}", "{historyEventLabel(item)}", 1)

    old_query = '''  const record = trpc.professionalRecord.get.useQuery(
    { patientId, page, pageSize: 20 },
    {
      enabled: patientId > 0,
      retry: false,
      refetchOnWindowFocus: true,
      refetchInterval: 10_000,
    }
  );'''
    new_query = '''  const requiresProfessionalRecord =
    section !== "reports" && section !== "messages";
  const record = trpc.professionalRecord.get.useQuery(
    { patientId, page, pageSize: 20 },
    {
      enabled: patientId > 0 && requiresProfessionalRecord,
      retry: false,
      refetchOnWindowFocus: true,
      refetchInterval: requiresProfessionalRecord ? 10_000 : false,
    }
  );'''
    if old_query in source:
        source = source.replace(old_query, new_query, 1)
    require("const requiresProfessionalRecord" in source, "record query was not patched")

    source = source.replace(
        "  if (record.isLoading) {",
        "  if (requiresProfessionalRecord && record.isLoading) {",
        1,
    )
    source = source.replace(
        "  if (record.isError || !record.data) {",
        "  if (requiresProfessionalRecord && (record.isError || !record.data)) {",
        1,
    )

    old_state = '''  const trackingStatus = record.data.patient.trackingStatus ?? "not_started";
  const active = trackingStatus === "active";
  const latest = record.data.latestAssessment;
  const transition = (nextStatus: "active" | "paused" | "ended") =>
    transitionTracking.mutate({
      accessId: record.data.patient.authorizationId,
      status: nextStatus,
      reason: transitionReason || undefined,
    });'''
    new_state = '''  const professionalRecord = record.data;
  const trackingStatus =
    professionalRecord?.patient.trackingStatus ??
    selectedPatient.trackingStatus ??
    "not_started";
  const active = trackingStatus === "active";
  const latest = professionalRecord?.latestAssessment ?? null;
  const transition = (nextStatus: "active" | "paused" | "ended") => {
    if (!professionalRecord) return;
    transitionTracking.mutate({
      accessId: professionalRecord.patient.authorizationId,
      status: nextStatus,
      reason: transitionReason || undefined,
    });
  };'''
    if old_state in source:
        source = source.replace(old_state, new_state, 1)
    require("const professionalRecord = record.data;" in source, "record state was not patched")

    source = source.replace("record={record.data}", "record={professionalRecord}")
    source = source.replace(
        "lastActivityAt={getLatestPatientActivityAt(record.data)}",
        "lastActivityAt={getLatestPatientActivityAt(professionalRecord ?? {})}",
        1,
    )

    for marker in (
        "const historyEventLabels",
        "Autoria não informada",
        "historyEventLabel(item)",
        "enabled: patientId > 0 && requiresProfessionalRecord",
        "const professionalRecord = record.data;",
    ):
        require(marker in source, f"workspace marker missing: {marker}")

    path.write_text(source, encoding="utf-8")
    print("patched workspace")


def patch_record_service() -> None:
    path = Path("server/modules/professionals/recordService.ts")
    source = path.read_text(encoding="utf-8")

    source, latest_count = re.subn(
        r"SELECT \* FROM professionalAssessments\s+WHERE authorizationId = \$\{scope\.authorizationId\}\s+ORDER BY version DESC LIMIT 1",
        """SELECT a.*, p.displayName AS authorName
      FROM professionalAssessments a
      LEFT JOIN professionalProfiles p ON p.userId = a.professionalUserId
      WHERE a.authorizationId = ${scope.authorizationId}
      ORDER BY a.version DESC LIMIT 1""",
        source,
        count=1,
    )
    require(latest_count == 1 or "SELECT a.*, p.displayName AS authorName" in source, "latest assessment SQL not patched")

    source, history_count = re.subn(
        r"SELECT id, version, objective, assessedAt, nextReviewAt, createdAt\s+FROM professionalAssessments\s+WHERE authorizationId = \$\{scope\.authorizationId\}\s+ORDER BY version DESC LIMIT \$\{input\.pageSize\} OFFSET \$\{offset\}",
        """SELECT a.id, a.version, a.objective, a.assessedAt, a.nextReviewAt,
        a.createdAt, p.displayName AS authorName
      FROM professionalAssessments a
      LEFT JOIN professionalProfiles p ON p.userId = a.professionalUserId
      WHERE a.authorizationId = ${scope.authorizationId}
      ORDER BY a.version DESC LIMIT ${input.pageSize} OFFSET ${offset}""",
        source,
        count=1,
    )
    require(history_count == 1 or "a.createdAt, p.displayName AS authorName" in source, "assessment history SQL not patched")

    source, notes_count = re.subn(
        r"SELECT id, content, createdAt, updatedAt FROM professionalNotes\s+WHERE authorizationId = \$\{scope\.authorizationId\}\s+ORDER BY createdAt DESC, id DESC LIMIT \$\{input\.pageSize\} OFFSET \$\{offset\}",
        """SELECT n.id, n.content, n.createdAt, n.updatedAt,
        p.displayName AS authorName
      FROM professionalNotes n
      LEFT JOIN professionalProfiles p ON p.userId = n.professionalUserId
      WHERE n.authorizationId = ${scope.authorizationId}
      ORDER BY n.createdAt DESC, n.id DESC
      LIMIT ${input.pageSize} OFFSET ${offset}""",
        source,
        count=1,
    )
    require(notes_count == 1 or "FROM professionalNotes n" in source, "notes SQL not patched")

    latest_marker = "          createdAt: timestamp(latest.createdAt),\n"
    if "authorName: String(latest.authorName" not in source:
        require(latest_marker in source, "latest assessment mapping marker not found")
        source = source.replace(
            latest_marker,
            latest_marker + '          authorName: String(latest.authorName ?? "Profissional"),\n',
            1,
        )

    assessment_start = source.index("assessmentHistory:")
    notes_start = source.index("notes:", assessment_start)
    assessment_block = source[assessment_start:notes_start]
    if "authorName: String(row.authorName" not in assessment_block:
        marker = "      assessedAt: timestamp(row.assessedAt), nextReviewAt: timestamp(row.nextReviewAt), createdAt: timestamp(row.createdAt),\n"
        require(marker in assessment_block, "assessment history mapping marker not found")
        assessment_block = assessment_block.replace(
            marker,
            marker + '      authorName: String(row.authorName ?? "Profissional"),\n',
            1,
        )
        source = source[:assessment_start] + assessment_block + source[notes_start:]

    notes_start = source.index("notes:", assessment_start)
    guidance_start = source.index("guidances:", notes_start)
    notes_block = source[notes_start:guidance_start]
    if "authorName: String(row.authorName" not in notes_block:
        marker = "      id: String(row.id), content: String(row.content ?? \"\"), createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt),\n"
        require(marker in notes_block, "notes mapping marker not found")
        notes_block = notes_block.replace(
            marker,
            marker + '      authorName: String(row.authorName ?? "Profissional"),\n',
            1,
        )
        source = source[:notes_start] + notes_block + source[guidance_start:]

    for marker in (
        "LEFT JOIN professionalProfiles p ON p.userId = a.professionalUserId",
        "LEFT JOIN professionalProfiles p ON p.userId = n.professionalUserId",
        "authorName: String(latest.authorName",
    ):
        require(marker in source, f"record service marker missing: {marker}")

    path.write_text(source, encoding="utf-8")
    print("patched record service")


patch_workspace()
patch_record_service()
