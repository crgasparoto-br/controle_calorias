import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage, { resolveSafeLoginReturnTo } from "./LoginPage";

const invalidateMe = vi.fn().mockResolvedValue(undefined);
const mutateLogin = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      auth: { me: { invalidate: invalidateMe } },
    }),
    auth: {
      login: {
        useMutation: () => ({
          mutate: mutateLogin,
          isPending: false,
        }),
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LoginPage", () => {
  it("renders the application logo", () => {
    render(React.createElement(LoginPage));

    expect(
      screen.getByRole("img", { name: "Controle de Calorias" })
    ).toBeTruthy();
  });
});

describe("resolveSafeLoginReturnTo", () => {
  it("preserves an internal WhatsApp onboarding return path", () => {
    expect(
      resolveSafeLoginReturnTo(
        "?returnTo=%2Fonboarding%2Fwhatsapp%2Ftoken-123456789012345678901234"
      )
    ).toBe("/onboarding/whatsapp/token-123456789012345678901234");
  });

  it.each([
    "",
    "?returnTo=https%3A%2F%2Fevil.example",
    "?returnTo=%2F%2Fevil.example",
    "?returnTo=%2F%5Cevil.example",
  ])("rejects an unsafe return target: %s", search => {
    expect(resolveSafeLoginReturnTo(search)).toBe("/");
  });
});
