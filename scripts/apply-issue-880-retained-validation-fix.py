from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one match in {path}, found {count}: {old[:160]!r}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "client/src/components/ProfessionalLayout.tsx",
    '''function isActiveRoute(location: string, path: string) {
  const pathname = pathnameFromLocation(location);
  if (path === "/professional") return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

function routeTitle(location: string) {
''',
    '''function isActiveRoute(location: string, path: string) {
  const pathname = pathnameFromLocation(location);
  if (path === "/professional") return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

function useRetainedSuccessfulValidation(
  resetKey: string | null,
  succeeded: boolean
) {
  const [validatedKey, setValidatedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!resetKey) {
      setValidatedKey(null);
      return;
    }
    if (succeeded) setValidatedKey(resetKey);
  }, [resetKey, succeeded]);

  return Boolean(resetKey && (succeeded || validatedKey === resetKey));
}

function routeTitle(location: string) {
''',
)

replace_once(
    "client/src/components/ProfessionalLayout.tsx",
    '''  const profileValidated = Boolean(
    profile.isFetchedAfterMount && profile.data !== undefined
  );
  const patientContextValidated = Boolean(
    routePatientId &&
      patientContext.isFetchedAfterMount &&
      patientContext.data !== undefined &&
      patientContext.data.patientId === routePatientId
  );

  const selectedPatient = useMemo<ProfessionalPatientContext | null>(() => {
    if (
      !hasActiveProfile ||
      !routePatientId ||
      !patientContextValidated ||
      readyPatientId !== routePatientId ||
      !patientContext.data
    ) {
''',
    '''  const profileValidationKey = user ? `user:${user.id}` : null;
  const profileValidationSucceeded = Boolean(
    profile.isSuccess &&
      profile.isFetchedAfterMount &&
      !profile.isFetching &&
      profile.data !== undefined
  );
  const profileValidated = useRetainedSuccessfulValidation(
    profileValidationKey,
    profileValidationSucceeded
  );
  const patientContextValidationKey =
    user && routePatientId && patientResource
      ? `user:${user.id}:patient:${routePatientId}:resource:${patientResource}`
      : null;
  const patientContextValidationSucceeded = Boolean(
    routePatientId &&
      patientContext.isSuccess &&
      patientContext.isFetchedAfterMount &&
      !patientContext.isFetching &&
      patientContext.data !== undefined &&
      patientContext.data.patientId === routePatientId
  );
  const patientContextValidated = useRetainedSuccessfulValidation(
    patientContextValidationKey,
    patientContextValidationSucceeded
  );
  const patientContextAccessRevoked = Boolean(
    routePatientId &&
      patientContext.isError &&
      isProfessionalPatientAccessUnavailableError(patientContext.error)
  );

  const selectedPatient = useMemo<ProfessionalPatientContext | null>(() => {
    if (
      !hasActiveProfile ||
      !routePatientId ||
      !patientContextValidated ||
      patientContextAccessRevoked ||
      readyPatientId !== routePatientId ||
      !patientContext.data
    ) {
''',
)
replace_once(
    "client/src/components/ProfessionalLayout.tsx",
    '''    patientContext.data,
    patientContextValidated,
    readyPatientId,
    routePatientId,
  ]);
''',
    '''    patientContext.data,
    patientContextAccessRevoked,
    patientContextValidated,
    readyPatientId,
    routePatientId,
  ]);
''',
)
replace_once(
    "client/src/components/ProfessionalLayout.tsx",
    '''  const revokedPatientAccess = Boolean(
    routePatientId &&
      patientContext.isError &&
      isProfessionalPatientAccessUnavailableError(patientContext.error)
  );
''',
    '''  const revokedPatientAccess = patientContextAccessRevoked;
''',
)

replace_once(
    "client/src/components/ProfessionalLayout.test.tsx",
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
    '''  it("keeps a validated patient visible during a background context refetch", async () => {
    location = "/professional/patients/10/messages";
    const view = renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());

    fetchingPatientContext();
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    expect(screen.getByText("Ana")).toBeTruthy();
    expect(
      screen.queryByText("Preparando o contexto seguro do paciente...")
    ).toBeNull();
    expect(document.title).toBe("Mensagens | Área Profissional");
  });

  it("keeps the shell visible during background auth and profile refresh", async () => {
    location = "/professional/patients/10";
    const view = renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());

    authState.loading = true;
    profileState = { ...profileState, isFetching: true };
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    expect(screen.getByText("Ana")).toBeTruthy();
  });

  it("keeps validated content visible after a non-authoritative background error", async () => {
    location = "/professional/patients/10";
    const view = renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());

    patientContextState = {
      ...patientContextState,
      isFetching: false,
      isError: true,
      isSuccess: false,
      error: new Error("Falha temporária de conexão"),
    };
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    expect(screen.getByText("Ana")).toBeTruthy();
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
    '''  it("keeps patient content protected on a temporary authorization failure", () => {
    location = "/professional/patients/10";
    patientContextState = {
      ...patientContextState,
      data: undefined,
      isFetching: false,
      isError: true,
      isSuccess: false,
      isFetchedAfterMount: true,
      error: new Error("Falha temporária de conexão"),
    };

    renderPatientLayout();

    expect(screen.getByRole("alert").textContent).toContain(
      "Não foi possível confirmar a autorização do paciente"
    );
    expect(screen.queryByText("Ana")).toBeNull();
  });
''',
    '''  it("does not trust retained cache when the first authorization revalidation fails", () => {
    location = "/professional/patients/10";
    patientContextState = {
      ...patientContextState,
      isFetching: false,
      isError: true,
      isSuccess: false,
      isFetchedAfterMount: true,
      error: new Error("Falha temporária de conexão"),
    };

    renderPatientLayout();

    expect(screen.getByRole("alert").textContent).toContain(
      "Não foi possível confirmar a autorização do paciente"
    );
    expect(screen.queryByText("Ana")).toBeNull();
  });

  it("does not trust a cached profile when the first profile revalidation fails", () => {
    location = "/professional/patients/10";
    profileState = {
      ...profileState,
      isFetching: false,
      isError: true,
      isSuccess: false,
      isFetchedAfterMount: true,
      error: new Error("Falha temporária de conexão"),
    };

    renderPatientLayout();

    expect(screen.getByRole("alert").textContent).toContain(
      "Não foi possível confirmar seu acesso"
    );
    expect(screen.queryByText("Ana")).toBeNull();
  });
''',
)

replace_once(
    "docs/design-docs/professional-navigation.md",
    '''- Perfil e contexto do paciente são revalidados periodicamente e quando a janela recupera o foco. Depois da validação inicial, `isFetching` e falhas transitórias de background não desmontam o shell, o cabeçalho nem o workspace; o último contexto validado permanece visível com aviso recuperável. Somente negação autoritativa, perfil inativo confirmado ou revogação remove o conteúdo.
''',
    '''- Perfil e contexto do paciente são revalidados periodicamente e quando a janela recupera o foco. O cache só pode permanecer visível depois de uma validação bem-sucedida no ciclo do usuário autenticado e no recurso exato da rota. Depois dessa validação, `isFetching` e falhas transitórias de background não desmontam o shell, o cabeçalho nem o workspace; o último contexto validado permanece visível com aviso recuperável. Falha na primeira revalidação continua protegida, mesmo quando existe cache antigo. Somente negação autoritativa, perfil inativo confirmado ou revogação remove o conteúdo.
''',
)

print("Retained-validation security fix applied successfully")
