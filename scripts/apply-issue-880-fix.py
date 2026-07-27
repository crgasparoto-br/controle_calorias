from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one match in {path}, found {count}: {old[:120]!r}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "client/src/pages/professional/ProfessionalPatientRouteGuard.tsx",
    '''  const pathname = location.split(/[?#]/, 1)[0].replace(/\\/+$/, "") || "/";
  return <ProfessionalPatientWorkspace key={pathname} />;
''',
    '''  const workspaceKey = selectedPatient.authorizationId
    ? `${selectedPatient.patientId}:${selectedPatient.authorizationId}`
    : `${selectedPatient.patientId}:${selectedPatient.trackingStatus}`;
  return <ProfessionalPatientWorkspace key={workspaceKey} />;
''',
)

replace_once(
    "client/src/pages/professional/ProfessionalPatientWorkspace.tsx",
    '''type PatientDraftSnapshot = {
  assessment: AssessmentDraft;
  note: string;
  guidanceTitle: string;
  guidance: string;
};
''',
    '''type PatientDraftSnapshot = {
  assessment: AssessmentDraft;
  note: string;
  guidanceTitle: string;
  guidance: string;
  pages: RecordPages;
};
''',
)
replace_once(
    "client/src/pages/professional/ProfessionalPatientWorkspace.tsx",
    '''function createEmptyPatientDraft(): PatientDraftSnapshot {
  return {
    assessment: { ...emptyAssessment },
    note: "",
    guidanceTitle: "",
    guidance: "",
  };
}
''',
    '''function createEmptyPatientDraft(): PatientDraftSnapshot {
  return {
    assessment: { ...emptyAssessment },
    note: "",
    guidanceTitle: "",
    guidance: "",
    pages: { ...initialRecordPages },
  };
}
''',
)
replace_once(
    "client/src/pages/professional/ProfessionalPatientWorkspace.tsx",
    '''  const [transitionReason, setTransitionReason] = useState("");
  const [pages, setPages] = useState<RecordPages>(initialRecordPages);
''',
    '''  const [transitionReason, setTransitionReason] = useState("");
  const [pages, setPages] = useState<RecordPages>(initialDraft.pages);
''',
)
replace_once(
    "client/src/pages/professional/ProfessionalPatientWorkspace.tsx",
    '''  const discardDraft = useCallback(() => {
    clearStoredProfessionalPatientDraftSnapshot(draftScope);
    setAssessment({ ...emptyAssessment });
    setNote("");
    setGuidanceTitle("");
    setGuidance("");
  }, [draftScope]);
''',
    '''  const discardDraft = useCallback(() => {
    const stored = getPatientDraftSnapshot(draftScope);
    clearStoredProfessionalPatientDraftSnapshot(draftScope);
    storePatientDraftSnapshot(draftScope, {
      ...createEmptyPatientDraft(),
      pages: stored.pages,
    });
    setAssessment({ ...emptyAssessment });
    setNote("");
    setGuidanceTitle("");
    setGuidance("");
  }, [draftScope]);
''',
)
replace_once(
    "client/src/pages/professional/ProfessionalPatientWorkspace.tsx",
    '''  const setPageForSection = useCallback(
    (targetSection: PaginatedRecordSection, page: number) => {
      setPages(current => ({ ...current, [targetSection]: Math.max(1, page) }));
    },
    []
  );
''',
    '''  const setPageForSection = useCallback(
    (targetSection: PaginatedRecordSection, page: number) => {
      setPages(current => {
        const next = { ...current, [targetSection]: Math.max(1, page) };
        storePatientDraftSnapshot(draftScope, {
          ...getPatientDraftSnapshot(draftScope),
          pages: next,
        });
        return next;
      });
    },
    [draftScope]
  );
''',
)
replace_once(
    "client/src/pages/professional/ProfessionalPatientWorkspace.tsx",
    '''    setGuidance(stored.guidance);
    setTransitionReason("");
    setPages(initialRecordPages);
  }, [draftScope]);
''',
    '''    setGuidance(stored.guidance);
    setTransitionReason("");
    setPages(stored.pages);
  }, [draftScope]);
''',
)

replace_once(
    "client/src/components/ProfessionalLayout.tsx",
    '''  const profileValidated = Boolean(
    profile.isSuccess && profile.isFetchedAfterMount && !profile.isFetching
  );
  const patientContextValidated = Boolean(
    routePatientId &&
      patientContext.isSuccess &&
      patientContext.isFetchedAfterMount &&
      !patientContext.isFetching &&
      patientContext.data?.patientId === routePatientId
  );
''',
    '''  const profileValidated = Boolean(
    profile.isFetchedAfterMount && profile.data !== undefined
  );
  const patientContextValidated = Boolean(
    routePatientId &&
      patientContext.isFetchedAfterMount &&
      patientContext.data !== undefined &&
      patientContext.data.patientId === routePatientId
  );
''',
)
replace_once(
    "client/src/components/ProfessionalLayout.tsx",
    '''  useEffect(() => {
    const refreshAccess = () => {
      invalidatePatientContext();
      void Promise.all([
        refreshAuth(),
        profile.refetch(),
        routePatientId && hasActiveProfile
          ? patientContext.refetch()
          : Promise.resolve(),
      ]);
    };
    window.addEventListener("focus", refreshAccess);
    return () => window.removeEventListener("focus", refreshAccess);
  }, [
    hasActiveProfile,
    invalidatePatientContext,
    patientContext,
    profile,
    refreshAuth,
    routePatientId,
  ]);
''',
    '''  useEffect(() => {
    const refreshAccess = () => {
      void Promise.all([
        refreshAuth(),
        profile.refetch(),
        routePatientId && hasActiveProfile
          ? patientContext.refetch()
          : Promise.resolve(),
      ]);
    };
    window.addEventListener("focus", refreshAccess);
    return () => window.removeEventListener("focus", refreshAccess);
  }, [hasActiveProfile, patientContext, profile, refreshAuth, routePatientId]);
''',
)
replace_once(
    "client/src/components/ProfessionalLayout.tsx",
    '''  if (authLoading || (user && !profileValidated && !profile.isError)) {
    return <DashboardLayoutSkeleton />;
  }
''',
    '''  if ((authLoading && !user) || (user && !profileValidated && !profile.isError)) {
    return <DashboardLayoutSkeleton />;
  }
''',
)
replace_once(
    "client/src/components/ProfessionalLayout.tsx",
    '''  if (profile.isError) {
''',
    '''  if (profile.isError && !profileValidated) {
''',
)
replace_once(
    "client/src/components/ProfessionalLayout.tsx",
    '''  const patientAccessUnavailable = Boolean(
    routePatientId && patientContext.isError && !revokedPatientAccess
  );
  const patientContextLoading = Boolean(
''',
    '''  const patientAccessUnavailable = Boolean(
    routePatientId &&
      patientContext.isError &&
      !revokedPatientAccess &&
      !patientContextValidated
  );
  const backgroundAccessValidationError = Boolean(
    (profile.isError && profileValidated) ||
      (routePatientId &&
        patientContext.isError &&
        !revokedPatientAccess &&
        patientContextValidated)
  );
  const patientContextLoading = Boolean(
''',
)
replace_once(
    "client/src/components/ProfessionalLayout.tsx",
    '''            {accessNotice === "patient-access-unavailable" ? (
              <div
                role="status"
                className="mb-4 rounded-2xl border bg-card p-4 text-sm"
              >
                O acesso a esse paciente não está mais disponível. A carteira
                foi atualizada e nenhum dado anterior permaneceu visível.
              </div>
            ) : null}

            {invalidPatientRoute ? (
''',
    '''            {accessNotice === "patient-access-unavailable" ? (
              <div
                role="status"
                className="mb-4 rounded-2xl border bg-card p-4 text-sm"
              >
                O acesso a esse paciente não está mais disponível. A carteira
                foi atualizada e nenhum dado anterior permaneceu visível.
              </div>
            ) : null}

            {backgroundAccessValidationError ? (
              <div
                role="status"
                className="mb-4 flex flex-col gap-3 rounded-2xl border bg-card p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <span>
                  Não foi possível atualizar a validação de acesso agora. O
                  contexto já validado permanece aberto.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void Promise.all([
                      profile.refetch(),
                      routePatientId && hasActiveProfile
                        ? patientContext.refetch()
                        : Promise.resolve(),
                    ])
                  }
                >
                  <RefreshCw className="h-4 w-4" />
                  Tentar novamente
                </Button>
              </div>
            ) : null}

            {invalidPatientRoute ? (
''',
)

replace_once(
    "client/src/pages/ProfessionalAreaPage.draftDiscard.test.tsx",
    '''import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
''',
    '''import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
''',
)
replace_once(
    "client/src/pages/ProfessionalAreaPage.draftDiscard.test.tsx",
    '''vi.mock("./professional/ProfessionalPatientWorkspace", () => ({
  default: () => {
    const [mountId] = React.useState(() => ++mounts);
    return <div>workspace-{mountId}</div>;
  },
}));
''',
    '''vi.mock("./professional/ProfessionalPatientWorkspace", () => ({
  default: () => {
    const [mountId] = React.useState(() => ++mounts);
    const [page, setPage] = React.useState(1);
    return (
      <div>
        <span>{`workspace-${mountId}-page-${page}`}</span>
        <button type="button" onClick={() => setPage(2)}>
          Ir para página 2
        </button>
      </div>
    );
  },
}));
''',
)
replace_once(
    "client/src/pages/ProfessionalAreaPage.draftDiscard.test.tsx",
    '''  it("remounts only the patient form after confirmed internal navigation", async () => {
    const { default: ProfessionalPatientRouteGuard } = await import(
      "./professional/ProfessionalPatientRouteGuard"
    );
    const view = render(<ProfessionalPatientRouteGuard />);

    expect(screen.getByText("workspace-1")).toBeTruthy();

    location = "/professional/patients/41/notes";
    view.rerender(<ProfessionalPatientRouteGuard />);

    expect(screen.queryByText("workspace-1")).toBeNull();
    expect(screen.getByText("workspace-2")).toBeTruthy();
  });
''',
    '''  it("keeps the patient workspace and collection state across internal sections", async () => {
    const user = userEvent.setup();
    const { default: ProfessionalPatientRouteGuard } = await import(
      "./professional/ProfessionalPatientRouteGuard"
    );
    const view = render(<ProfessionalPatientRouteGuard />);

    expect(screen.getByText("workspace-1-page-1")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Ir para página 2" }));
    expect(screen.getByText("workspace-1-page-2")).toBeTruthy();

    location = "/professional/patients/41/notes";
    view.rerender(<ProfessionalPatientRouteGuard />);

    expect(screen.getByText("workspace-1-page-2")).toBeTruthy();
    expect(screen.queryByText("workspace-2-page-1")).toBeNull();
  });
''',
)
replace_once(
    "client/src/pages/ProfessionalAreaPage.draftDiscard.test.tsx",
    '''    expect(screen.getByText("workspace-1")).toBeTruthy();

    location = "/professional/patients/72/assessment";
    view.rerender(<ProfessionalPatientRouteGuard />);

    expect(screen.queryByText("workspace-1")).toBeNull();
    expect(screen.getByText("workspace-2")).toBeTruthy();
''',
    '''    expect(screen.getByText("workspace-1-page-1")).toBeTruthy();

    location = "/professional/patients/72/assessment";
    view.rerender(<ProfessionalPatientRouteGuard />);

    expect(screen.queryByText("workspace-1-page-1")).toBeNull();
    expect(screen.getByText("workspace-2-page-1")).toBeTruthy();
''',
)

replace_once(
    "client/src/components/ProfessionalLayout.test.tsx",
    '''  it("keeps cached authorization protected until refetch finishes", async () => {
    location = "/professional/patients/10/messages";
    fetchingPatientContext();
    const view = renderPatientLayout();

    expect(screen.queryByText("Ana")).toBeNull();
    expect(
      screen.getByText("Preparando o contexto seguro do paciente...")
    ).toBeTruthy();

    freshPatientContext();
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());
    expect(document.title).toBe("Mensagens | Área Profissional");
  });
''',
    '''  it("keeps a validated patient visible during a background context refetch", async () => {
    location = "/professional/patients/10/messages";
    fetchingPatientContext();
    renderPatientLayout();

    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());
    expect(
      screen.queryByText("Preparando o contexto seguro do paciente...")
    ).toBeNull();
    expect(document.title).toBe("Mensagens | Área Profissional");
  });

  it("keeps the shell visible during background auth and profile refresh", async () => {
    location = "/professional/patients/10";
    authState.loading = true;
    profileState = { ...profileState, isFetching: true };

    renderPatientLayout();

    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());
  });

  it("keeps validated content visible after a non-authoritative background error", async () => {
    location = "/professional/patients/10";
    patientContextState = {
      ...patientContextState,
      isFetching: false,
      isError: true,
      isSuccess: false,
      error: new Error("Falha temporária de conexão"),
    };

    renderPatientLayout();

    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());
    expect(
      screen.getByText(
        "Não foi possível atualizar a validação de acesso agora. O contexto já validado permanece aberto."
      )
    ).toBeTruthy();
    expect(setLocation).not.toHaveBeenCalled();
  });
''',
)
replace_once(
    "client/src/components/ProfessionalLayout.test.tsx",
    '''    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(profileRefetch).toHaveBeenCalledTimes(1);
    expect(contextRefetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText("Ana")).toBeNull());
''',
    '''    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(profileRefetch).toHaveBeenCalledTimes(1);
    expect(contextRefetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Ana")).toBeTruthy();
''',
)

replace_once(
    "docs/design-docs/professional-navigation.md",
    '''- Perfil e contexto do paciente são revalidados periodicamente e quando a janela recupera o foco.
''',
    '''- Perfil e contexto do paciente são revalidados periodicamente e quando a janela recupera o foco. Depois da validação inicial, `isFetching` e falhas transitórias de background não desmontam o shell, o cabeçalho nem o workspace; o último contexto validado permanece visível com aviso recuperável. Somente negação autoritativa, perfil inativo confirmado ou revogação remove o conteúdo.
''',
)
replace_once(
    "docs/design-docs/professional-navigation.md",
    '''- Avaliações, anotações, orientações e histórico mantêm páginas independentes. Trocar de área preserva a página daquela coleção e nunca reutiliza o deslocamento de outra lista.
''',
    '''- Avaliações, anotações, orientações e histórico mantêm páginas independentes no snapshot transitório do par `authorizationId`/`patientId`. Trocar de área, inclusive por uma superfície com entitlement diferente, preserva a página daquela coleção e nunca reutiliza o deslocamento de outra lista. O workspace só remonta quando muda o paciente ou o ciclo de autorização.
''',
)
replace_once(
    "docs/testing/professional-workspace-routing.md",
    '''- Ao confirmar o descarte, a navegação deve remontar o workspace da rota de destino antes de exibir o próximo formulário, eliminando os estados não salvos da rota anterior.
- A troca de `patientId` sempre deve remontar o workspace, mesmo quando a seção da URL permanecer igual, para impedir reutilização de rascunho entre pacientes.
''',
    '''- Ao confirmar o descarte, os campos não salvos são eliminados e a navegação interna prossegue sem exigir remount quando `patientId` e `authorizationId` permanecem iguais. A paginação independente das coleções continua preservada.
- A troca de `patientId` ou de `authorizationId` sempre remonta o workspace, mesmo quando a seção da URL permanecer igual, para impedir reutilização de rascunho ou estado transitório entre pacientes e ciclos de autorização.
''',
)
replace_once(
    "docs/testing/professional-workspace-routing.md",
    '''20. Abrir Metas em acompanhamento ativo, criar uma exceção e confirmar que a ação principal pode ser habilitada; em seguida pausar o acompanhamento sem desmontar a rota e confirmar que todos os controles mutáveis, inclusive a exceção e o retry de notificação, ficam desabilitados.
''',
    '''20. Abrir Metas em acompanhamento ativo, criar uma exceção e confirmar que a ação principal pode ser habilitada; em seguida pausar o acompanhamento sem desmontar a rota e confirmar que todos os controles mutáveis, inclusive a exceção e o retry de notificação, ficam desabilitados.
21. Avançar avaliações para a página 2, alternar por anotações, relatório e mensagens e retornar à avaliação; a página 2 deve permanecer associada ao mesmo `authorizationId`/`patientId`.
22. Com um paciente já validado e visível, iniciar refetch de perfil e contexto, inclusive por foco e intervalo; cabeçalho, workspace e paginação devem permanecer montados. Repetir com erro transitório para confirmar aviso recuperável e com `FORBIDDEN` para confirmar limpeza imediata.
''',
)
replace_once(
    "docs/testing/professional-workspace-routing.md",
    '''- Cancelar preserva rota, paciente e campos montados; confirmar o descarte permite a navegação e o remount da rota de destino; após salvar, não há diálogo.
''',
    '''- Cancelar preserva rota, paciente e campos montados; confirmar o descarte limpa somente os campos não salvos e permite a navegação. Se paciente e autorização não mudarem, o workspace permanece montado e conserva paginações; após salvar, não há diálogo.
''',
)

print("Issue #880 continuity fixes applied successfully")
