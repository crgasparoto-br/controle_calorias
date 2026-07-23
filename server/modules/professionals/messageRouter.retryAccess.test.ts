import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRetryAccess: vi.fn(),
  deliver: vi.fn(),
}));

vi.mock("./entitledProcedure", async () => {
  const { protectedProcedure } = await import("../../_core/trpc");
  return { professionalMessagesProcedure: protectedProcedure };
});
vi.mock("./messageRetryAccess", async importOriginal => {
  const actual = await importOriginal<typeof import("./messageRetryAccess")>();
  return {
    ...actual,
    assertProfessionalMessageRetryAccess: mocks.assertRetryAccess,
  };
});
vi.mock("./messageService", () => ({
  createProfessionalMessage: vi.fn(),
  deliverProfessionalMessage: mocks.deliver,
  listPatientProfessionalMessages: vi.fn(),
  listProfessionalMessages: vi.fn(),
}));
vi.mock("./settingsService", () => ({
  getProfessionalSettingsSnapshot: vi.fn(),
}));
vi.mock("./service", () => ({
  listProfessionalAccesses: vi.fn(),
}));

import { ProfessionalMessageAccessUnavailableError } from "./messageRetryAccess";
import { professionalMessageRouter } from "./messageRouter";

const messageId = "f3c9b83a-7574-4ddf-a291-964b420393e2";

function caller() {
  return professionalMessageRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: { id: 7 } as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deliver.mockResolvedValue({ status: "unchanged" });
});

describe("professionalMessageRouter.retry", () => {
  it("maps a confirmed authorization revocation to FORBIDDEN", async () => {
    mocks.assertRetryAccess.mockRejectedValue(
      new ProfessionalMessageAccessUnavailableError()
    );

    await expect(caller().retry({ messageId })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "O acesso a este paciente não está mais disponível.",
    } satisfies Partial<TRPCError>);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("preserves unchanged delivery for an approved concurrent retry", async () => {
    mocks.assertRetryAccess.mockResolvedValue(undefined);

    await expect(caller().retry({ messageId })).resolves.toEqual({
      status: "unchanged",
    });
    expect(mocks.deliver).toHaveBeenCalledWith(messageId, 7);
  });
});
