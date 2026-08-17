import { beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

const registerLocalUser = vi.fn();
const authenticateLocalUser = vi.fn();
const signSession = vi.fn();

vi.mock("./_core/localAuth", () => ({
  registerLocalUser,
  authenticateLocalUser,
}));

vi.mock("./_core/sdk", () => ({
  sdk: {
    signSession,
  },
}));

const { appRouter } = await import("./routers");

type CookieRecord = {
  name: string;
  value: string;
  options: Record<string, unknown>;
};

type ClearCookieRecord = {
  name: string;
  options: Record<string, unknown>;
};

function createContext(user: TrpcContext["user"] = null): {
  ctx: TrpcContext;
  cookies: CookieRecord[];
  clearedCookies: ClearCookieRecord[];
} {
  const cookies: CookieRecord[] = [];
  const clearedCookies: ClearCookieRecord[] = [];

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => {
        cookies.push({ name, value, options });
      },
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, cookies, clearedCookies };
}

describe("auth local router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signSession.mockResolvedValue("session-token");
  });

  it("registers with name, email and password", async () => {
    registerLocalUser.mockResolvedValue({
      id: 101,
      openId: "local:101",
      email: "ana@example.com",
      name: "Ana",
      loginMethod: "password",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    });

    const { ctx, cookies } = createContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.register({
      name: "Ana",
      email: "ana@example.com",
      password: "SenhaForte123",
    });

    expect(registerLocalUser).toHaveBeenCalledWith({
      name: "Ana",
      email: "ana@example.com",
      password: "SenhaForte123",
    });
    expect(result).toMatchObject({
      id: 101,
      email: "ana@example.com",
      name: "Ana",
      role: "user",
    });
    expect((result as Record<string, unknown>).passwordHash).toBeUndefined();
    expect(cookies[0]).toMatchObject({
      name: COOKIE_NAME,
      value: "session-token",
    });
  });

  it("returns sanitized error when registering duplicate email", async () => {
    registerLocalUser.mockRejectedValue(new Error("EMAIL_ALREADY_REGISTERED"));

    const { ctx } = createContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.auth.register({
      name: "Ana",
      email: "ana@example.com",
      password: "SenhaForte123",
    })).rejects.toThrow("Não foi possível criar a conta com estes dados.");
  });

  it("logs in with valid credentials", async () => {
    authenticateLocalUser.mockResolvedValue({
      id: 102,
      openId: "local:102",
      email: "bruno@example.com",
      name: "Bruno",
      loginMethod: "password",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    });

    const { ctx, cookies } = createContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.login({
      email: "bruno@example.com",
      password: "SenhaForte123",
    });

    expect(authenticateLocalUser).toHaveBeenCalledWith({
      email: "bruno@example.com",
      password: "SenhaForte123",
    });
    expect(result).toMatchObject({
      id: 102,
      email: "bruno@example.com",
      name: "Bruno",
      role: "user",
    });
    expect((result as Record<string, unknown>).passwordHash).toBeUndefined();
    expect(cookies[0]?.name).toBe(COOKIE_NAME);
  });

  it("returns sanitized error when password is invalid", async () => {
    authenticateLocalUser.mockRejectedValue(new Error("INVALID_CREDENTIALS"));

    const { ctx } = createContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.auth.login({
      email: "bruno@example.com",
      password: "senha-incorreta",
    })).rejects.toThrow("E-mail ou senha inválidos.");
  });

  it("clears cookie on logout", async () => {
    const user = {
      id: 1,
      openId: "local:1",
      email: "user@example.com",
      name: "User",
      loginMethod: "password",
      role: "user" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };
    const { ctx, clearedCookies } = createContext(user);
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies[0]).toMatchObject({
      name: COOKIE_NAME,
      options: {
        httpOnly: true,
        path: "/",
        sameSite: "none",
        secure: true,
        maxAge: -1,
      },
    });
  });

  it("auth.me returns current user without password hash", async () => {
    const user = {
      id: 77,
      openId: "local:77",
      email: "me@example.com",
      name: "Me",
      loginMethod: "password",
      role: "admin" as const,
      passwordHash: "hidden",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };

    const { ctx } = createContext(user as unknown as TrpcContext["user"]);
    const caller = appRouter.createCaller(ctx);

    const me = await caller.auth.me();

    expect(me).toMatchObject({
      id: 77,
      email: "me@example.com",
      name: "Me",
      role: "admin",
    });
    expect((me as Record<string, unknown>)?.passwordHash).toBeUndefined();
  });
});
