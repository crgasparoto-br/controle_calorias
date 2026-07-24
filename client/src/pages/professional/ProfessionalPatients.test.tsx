// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  portfolioUseQuery,
  refetch,
  invalidate,
  patientTimeZoneFetch,
  requestAccessMutate,
} = vi.hoisted(() => ({
  portfolioUseQuery: vi.fn(),
  refetch: vi.fn().mockResolvedValue(undefined),
  invalidate: vi.fn().mockResolvedValue(undefined),
  patientTimeZoneFetch: vi.fn().mockResolvedValue(undefined),
  requestAccessMutate: vi.fn(),
}));

vi.mock("@/components/professional/ProfessionalUi", () => ({
  ProfessionalPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
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
          useMutation: (options: { onSuccess?: () => Promise<void> | void }) => ({
            isPending: false,
            isError: false,
            error: null,
            mutate: (input: unknown) => {
              requestAccessMutate(input);
              void options.onSuccess?.();
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
} from "./ProfessionalPatients";

function queryResult(page = 1) {
  return {
    data: {
      items: [],
      pagination: { page, pageSize: 20, total: 60, totalPages: 3 },
    },
    isLoading: false,
    isError: false,
    refetch,
  };
}

beforeEach(() => {
  window.history.replaceState({}, "", "/professional/patients?page=2");
  portfolioUseQuery.mockImplementation((input: { page: number }) => queryResult(input.page));
  portfolioUseQuery.mockClear();
  refetch.mockClear();
  invalidate.mockClear();
  patientTimeZoneFetch.mockClear();
  requestAccessMutate.mockClear();
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

    fireEvent.click(screen.getByRole("button", { name: "Solicitar acesso" }));
    fireEvent.change(screen.getByPlaceholderText("paciente@exemplo.com ou celular"), {
      target: { value: "novo@paciente.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Ex.: iniciar acompanhamento nutricional"), {
      target: { value: "Iniciar acompanhamento" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar solicitação" }));

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
    expect(screen.getByRole("status")).toHaveTextContent(
      "A carteira foi atualizada para mostrar os acessos pendentes."
    );
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
