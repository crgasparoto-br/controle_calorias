// @vitest-environment jsdom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  portfolioUseQuery,
  refetch,
  invalidate,
  patientTimeZoneFetch,
  requestAccessMutate,
  requestAccessResult,
} = vi.hoisted(() => ({
  portfolioUseQuery: vi.fn(),
  refetch: vi.fn().mockResolvedValue(undefined),
  invalidate: vi.fn().mockResolvedValue(undefined),
  patientTimeZoneFetch: vi.fn().mockResolvedValue(undefined),
  requestAccessMutate: vi.fn(),
  requestAccessResult: {
    current: {
      status: "pending" as "pending" | "approved" | "rejected" | "revoked",
    },
  },
}));

vi.mock("@/components/professional/ProfessionalUi", () => ({
  ProfessionalPage: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
  ProfessionalPageHeader: ({
    title,
    actions,
  }: {
    title: string;
    actions?: React.ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
  ProfessionalStatusBadge: ({ value }: { value: string }) => <span>{value}</span>,
  ProfessionalLoadingState: ({ label }: { label: string }) => <p>{label}</p>,
  ProfessionalAsyncState: ({ title }: { title: string }) => <p>{title}</p>,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      nutrition: {
        professionals: {
          patientTimeZone: { fetch: patientTimeZoneFetch },
          myAccesses: { invalidate },
        },
      },
    }),
    nutrition: {
      professionals: {
        portfolio: { useQuery: portfolioUseQuery },
        requestAccess: {
          useMutation: (options: {
            onSuccess?: (result: { status: string }) => Promise<void> | void;
          }) => ({
            isPending: false,
            isError: false,
            error: null,
            mutate: (input: unknown) => {
              requestAccessMutate(input);
              void options.onSuccess?.(requestAccessResult.current);
            },
            reset: vi.fn(),
          }),
        },
      },
    },
  },
}));

import ProfessionalPatients, {
  filtersFromLocation,
  filtersToLocation,
  requestAccessErrorMessage,
  requestAccessSuccessState,
} from "./ProfessionalPatients";

function queryResult(
  page = 1,
  items: Array<Record<string, unknown>> = [],
  totalPages = 3
) {
  return {
    data: {
      items,
      pagination: {
        page,
        pageSize: 20,
        total: totalPages === 0 ? 0 : Math.max(items.length, 60),
        totalPages,
      },
    },
    isLoading: false,
    isError: false,
    refetch,
  };
}

function submitRequest() {
  fireEvent.click(screen.getByRole("button", { name: "Solicitar acesso" }));
  fireEvent.change(
    screen.getByPlaceholderText("paciente@exemplo.com ou celular"),
    { target: { value: "novo@paciente.com" } }
  );
  fireEvent.change(
    screen.getByPlaceholderText("Ex.: iniciar acompanhamento nutricional"),
    { target: { value: "Iniciar acompanhamento" } }
  );
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitação" }));
}

beforeEach(() => {
  window.history.replaceState({}, "", "/professional/patients?page=2");
  portfolioUseQuery.mockImplementation((input: { page: number }) =>
    queryResult(input.page)
  );
  portfolioUseQuery.mockClear();
  refetch.mockClear();
  invalidate.mockClear();
  patientTimeZoneFetch.mockClear();
  patientTimeZoneFetch.mockResolvedValue(undefined);
  requestAccessMutate.mockClear();
  requestAccessResult.current = { status: "pending" };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ProfessionalPatients URL contract", () => {
  it("restores all valid filters and pagination from the URL", () => {
    const filters = filtersFromLocation(
      "/professional/patients?search=ana&authorization=approved&tracking=paused&activity=inactive&review=overdue&page=3"
    );
    expect(filters).toEqual({
      search: "ana",
      authorizationStatus: "approved",
      trackingStatus: "paused",
      activity: "inactive",
      nextReview: "overdue",
      page: 3,
      pageSize: 20,
    });
    expect(filtersToLocation(filters)).toBe(
      "/professional/patients?search=ana&authorization=approved&tracking=paused&activity=inactive&review=overdue&page=3"
    );
  });

  it("normalizes invalid query values without preserving unsafe state", () => {
    expect(
      filtersFromLocation(
        "/professional/patients?authorization=unknown&tracking=wrong&activity=x&review=y&page=-2"
      )
    ).toEqual({
      search: "",
      authorizationStatus: "all",
      trackingStatus: "all",
      activity: "all",
      nextReview: "all",
      page: 1,
      pageSize: 20,
    });
  });
});

describe("ProfessionalPatients filter interactions", () => {
  it("keeps a selected filter and writes it to the URL while resetting pagination", async () => {
    render(<ProfessionalPatients />);
    const authorization = screen.getByRole("combobox", {
      name: "Filtrar autorização",
    }) as HTMLSelectElement;
    fireEvent.change(authorization, { target: { value: "approved" } });
    await waitFor(() => {
      expect(authorization.value).toBe("approved");
      expect(window.location.search).toBe("?authorization=approved");
    });
    expect(portfolioUseQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ authorizationStatus: "approved", page: 1 }),
      expect.any(Object)
    );
  });

  it("updates pagination without being reverted by the previous URL", async () => {
    render(<ProfessionalPatients />);
    fireEvent.click(screen.getByRole("button", { name: /próxima/i }));
    await waitFor(() => {
      expect(window.location.search).toBe("?page=3");
    });
    expect(portfolioUseQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 3 }),
      expect.any(Object)
    );
  });

  it("debounces search, resets the page and avoids intermediate query values", async () => {
    vi.useFakeTimers();
    render(<ProfessionalPatients />);
    portfolioUseQuery.mockClear();
    const search = screen.getByPlaceholderText(
      "Nome, e-mail ou identificador"
    ) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "a" } });
    fireEvent.change(search, { target: { value: "an" } });
    fireEvent.change(search, { target: { value: "ana" } });
    expect(window.location.search).toBe("?page=2");
    expect(
      portfolioUseQuery.mock.calls.some(
        ([input]) => input.search === "a" || input.search === "an"
      )
    ).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(window.location.search).toBe("?search=ana");
    expect(portfolioUseQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "ana", page: 1 }),
      expect.any(Object)
    );
  });

  it("restores filter controls after browser navigation", async () => {
    window.history.replaceState(
      {},
      "",
      "/professional/patients?authorization=approved&page=2"
    );
    render(<ProfessionalPatients />);
    expect(
      (screen.getByRole("combobox", {
        name: "Filtrar autorização",
      }) as HTMLSelectElement).value
    ).toBe("approved");
    act(() => {
      window.history.pushState(
        {},
        "",
        "/professional/patients?authorization=revoked&page=1"
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("combobox", {
          name: "Filtrar autorização",
        }) as HTMLSelectElement).value
      ).toBe("revoked")
    );
  });

  it("shows pending requests after success even from incompatible filters", async () => {
    window.history.replaceState(
      {},
      "",
      "/professional/patients?search=ana&authorization=approved&tracking=active&activity=recent&review=scheduled&page=3"
    );
    render(<ProfessionalPatients />);
    submitRequest();
    await waitFor(() => {
      expect(window.location.search).toBe("?authorization=pending");
      expect(
        (screen.getByRole("combobox", {
          name: "Filtrar autorização",
        }) as HTMLSelectElement).value
      ).toBe("pending");
    });
    expect(
      (screen.getByPlaceholderText(
        "Nome, e-mail ou identificador"
      ) as HTMLInputElement).value
    ).toBe("");
    expect(portfolioUseQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: "",
        authorizationStatus: "pending",
        trackingStatus: "all",
        activity: "all",
        nextReview: "all",
        page: 1,
      }),
      expect.any(Object)
    );
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain(
      "A carteira foi atualizada para mostrar os acessos pendentes."
    );
  });

  it("refreshes the portfolio when the pending filter is already active", async () => {
    window.history.replaceState(
      {},
      "",
      "/professional/patients?authorization=pending"
    );
    render(<ProfessionalPatients />);

    submitRequest();

    await waitFor(() => {
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenCalledTimes(1);
    });
    expect(window.location.search).toBe("?authorization=pending");
    expect(screen.getByRole("status").textContent).toContain(
      "A carteira foi atualizada para mostrar os acessos pendentes."
    );
  });

  it("keeps an already approved relationship in the approved view", async () => {
    requestAccessResult.current = { status: "approved" };
    window.history.replaceState(
      {},
      "",
      "/professional/patients?authorization=pending&tracking=active&page=2"
    );
    render(<ProfessionalPatients />);
    submitRequest();
    await waitFor(() => {
      expect(window.location.search).toBe("?authorization=approved");
    });
    expect(portfolioUseQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: "",
        authorizationStatus: "approved",
        trackingStatus: "all",
        activity: "all",
        nextReview: "all",
        page: 1,
      }),
      expect.any(Object)
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Este paciente já autorizou o acesso."
    );
  });
});

describe("ProfessionalPatients request form", () => {
  it("mirrors the canonical maximum lengths", () => {
    render(<ProfessionalPatients />);
    fireEvent.click(screen.getByRole("button", { name: "Solicitar acesso" }));

    expect(
      screen
        .getByPlaceholderText("paciente@exemplo.com ou celular")
        .getAttribute("maxlength")
    ).toBe("320");
    expect(
      screen
        .getByPlaceholderText("Ex.: iniciar acompanhamento nutricional")
        .getAttribute("maxlength")
    ).toBe("500");
  });
});

describe("ProfessionalPatients patient rows", () => {
  const patientItems = [
    {
      authorizationId: "approved-1",
      patientUserId: 41,
      patientName: "Paciente Aprovado com Nome Muito Longo para Validação",
      patientEmail: "approved@example.com",
      authorizationStatus: "approved",
      trackingStatus: "not_started",
      lastFoodActivityAt: null,
      nextReviewAt: null,
    },
    {
      authorizationId: "pending-1",
      patientUserId: 42,
      patientName: "Paciente Pendente",
      patientEmail: "must-not-render@example.com",
      authorizationStatus: "pending",
      trackingStatus: null,
    },
    {
      authorizationId: "rejected-1",
      patientUserId: 43,
      patientName: "Paciente Recusado",
      authorizationStatus: "rejected",
      trackingStatus: null,
    },
    {
      authorizationId: "revoked-1",
      patientUserId: 44,
      patientName: "Paciente Revogado",
      authorizationStatus: "revoked",
      trackingStatus: null,
    },
  ];

  it("separates authorization and tracking and exposes safe fallback values", () => {
    window.history.replaceState({}, "", "/professional/patients");
    portfolioUseQuery.mockImplementation(() =>
      queryResult(1, patientItems, 1)
    );

    render(<ProfessionalPatients />);

    expect(screen.getByText("approved")).not.toBeNull();
    expect(screen.getByText("not_started")).not.toBeNull();
    expect(screen.getByText("Não informado")).not.toBeNull();
    expect(
      screen.getByText("Sem revisão agendada", { selector: "dd" })
    ).not.toBeNull();
    expect(screen.queryByText("must-not-render@example.com")).toBeNull();

    expect(
      (screen.getByRole("button", { name: "Abrir paciente" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Aguardando autorização",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Solicitação recusada",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Acesso revogado" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      screen.getAllByText("Dados pessoais e clínicos disponíveis após autorização")
    ).toHaveLength(3);
  });

  it("validates an approved patient before navigating to the contextual route", async () => {
    window.history.replaceState({}, "", "/professional/patients");
    portfolioUseQuery.mockImplementation(() =>
      queryResult(1, [patientItems[0]], 1)
    );
    render(<ProfessionalPatients />);

    fireEvent.click(screen.getByRole("button", { name: "Abrir paciente" }));

    await waitFor(() =>
      expect(patientTimeZoneFetch).toHaveBeenCalledWith({
        patientId: 41,
        weekOffset: 0,
      })
    );
    await waitFor(() =>
      expect(window.location.pathname).toBe("/professional/patients/41")
    );
  });

  it("removes stale patient data when access validation and refresh fail", async () => {
    window.history.replaceState({}, "", "/professional/patients");
    patientTimeZoneFetch.mockRejectedValueOnce(new Error("FORBIDDEN"));
    refetch.mockRejectedValueOnce(new Error("temporary refresh failure"));
    portfolioUseQuery.mockImplementation(() =>
      queryResult(1, [patientItems[0]], 1)
    );
    render(<ProfessionalPatients />);

    fireEvent.click(screen.getByRole("button", { name: "Abrir paciente" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "O acesso a este paciente não está mais disponível."
      );
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(patientItems[0].patientName)).toBeNull();
      expect(screen.queryByText(patientItems[0].patientEmail)).toBeNull();
      expect(screen.queryByRole("button", { name: "Abrir paciente" })).toBeNull();
    });
    expect(window.location.pathname).toBe("/professional/patients");
  });
});

describe("ProfessionalPatients request result mapping", () => {
  it("maps pending and approved to different messages and filters", () => {
    expect(requestAccessSuccessState({ status: "pending" })).toEqual({
      authorizationStatus: "pending",
      message:
        "Solicitação registrada. A carteira foi atualizada para mostrar os acessos pendentes.",
    });
    expect(requestAccessSuccessState({ status: "approved" })).toEqual({
      authorizationStatus: "approved",
      message:
        "Este paciente já autorizou o acesso. A carteira foi atualizada para mostrar os acessos aprovados.",
    });
  });
});

describe("ProfessionalPatients safe request errors", () => {
  it.each(["FORBIDDEN", "NOT_FOUND", "BAD_REQUEST"])(
    "does not enumerate patient state for %s",
    code => {
      expect(requestAccessErrorMessage({ data: { code } })).toBe(
        "Não foi possível enviar a solicitação com os dados informados. Confira o contato ou tente novamente mais tarde."
      );
    }
  );

  it("uses a generic message for unexpected failures", () => {
    expect(requestAccessErrorMessage(new Error("Failed query: users"))).toBe(
      "Não foi possível enviar a solicitação agora. Tente novamente em alguns instantes."
    );
  });
});
