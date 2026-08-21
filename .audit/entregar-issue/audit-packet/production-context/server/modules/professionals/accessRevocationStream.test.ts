import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProfessionalAccessRevocationStreamHandler } from "./accessRevocationStream";

type FakeResponse = EventEmitter & {
  statusCode: number;
  headers: Record<string, string>;
  chunks: string[];
  jsonBody: unknown;
  status: (code: number) => FakeResponse;
  setHeader: (name: string, value: string) => void;
  flushHeaders: () => void;
  write: (chunk: string) => boolean;
  flush: () => void;
  end: () => void;
  json: (body: unknown) => FakeResponse;
};

function response(): FakeResponse {
  const res = new EventEmitter() as FakeResponse;
  res.statusCode = 200;
  res.headers = {};
  res.chunks = [];
  res.jsonBody = undefined;
  res.status = code => {
    res.statusCode = code;
    return res;
  };
  res.setHeader = (name, value) => {
    res.headers[name] = value;
  };
  res.flushHeaders = vi.fn();
  res.write = chunk => {
    res.chunks.push(chunk);
    return true;
  };
  res.flush = vi.fn();
  res.end = vi.fn();
  res.json = body => {
    res.jsonBody = body;
    return res;
  };
  return res;
}

function request(query: Record<string, string>) {
  const req = new EventEmitter() as EventEmitter & { query: Record<string, string> };
  req.query = query;
  return req;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("professional access revocation SSE boundary", () => {
  it("authenticates, authorizes the exact route resource and streams a minimized event", async () => {
    const authorize = vi.fn().mockResolvedValue({ patientId: 41 });
    const unsubscribe = vi.fn();
    let listener: ((event: any) => void) | null = null;
    const handler = createProfessionalAccessRevocationStreamHandler({
      authenticate: vi.fn().mockResolvedValue({ id: 7 }),
      authorize,
      findPersistedRevocation: vi.fn().mockResolvedValue(null),
      subscribe: (professionalUserId, patientUserId, next) => {
        expect(professionalUserId).toBe(7);
        expect(patientUserId).toBe(41);
        listener = next;
        return unsubscribe;
      },
      heartbeatIntervalMs: 60_000,
    });
    const req = request({ patientId: "41", resource: "professional_reports" });
    const res = response();

    await handler(req as unknown as Request, res as unknown as Response);

    expect(authorize).toHaveBeenCalledWith(7, {
      patientId: 41,
      resource: "professional_reports",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toContain("text/event-stream");

    listener?.({
      type: "access_revoked",
      professionalUserId: 7,
      patientUserId: 41,
      authorizationId: "authorization-secret",
      occurredAt: 123,
    });
    const output = res.chunks.join("");
    expect(output).toContain("event: access_revoked");
    expect(output).toContain('"patientId":41');
    expect(output).not.toContain("authorization-secret");

    expect(res.end).toHaveBeenCalledTimes(1);
    req.emit("close");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("detects a persisted revocation created by another server instance", async () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn();
    const findPersistedRevocation = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ patientUserId: 41, occurredAt: 456 });
    const handler = createProfessionalAccessRevocationStreamHandler({
      authenticate: vi.fn().mockResolvedValue({ id: 7 }),
      authorize: vi.fn().mockResolvedValue({ patientId: 41 }),
      subscribe: () => unsubscribe,
      findPersistedRevocation,
      heartbeatIntervalMs: 60_000,
      crossInstanceCheckIntervalMs: 100,
    });
    const req = request({ patientId: "41", resource: "professional_record" });
    const res = response();

    await handler(req as unknown as Request, res as unknown as Response);
    await vi.advanceTimersByTimeAsync(220);

    expect(findPersistedRevocation).toHaveBeenCalled();
    expect(res.chunks.join("")).toContain('"occurredAt":456');
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed identifiers before authentication", async () => {
    const authenticate = vi.fn();
    const handler = createProfessionalAccessRevocationStreamHandler({
      authenticate,
      authorize: vi.fn(),
      subscribe: vi.fn() as never,
      findPersistedRevocation: vi.fn().mockResolvedValue(null),
    });
    const req = request({ patientId: "0", resource: "professional_record" });
    const res = response();

    await handler(req as unknown as Request, res as unknown as Response);

    expect(res.statusCode).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("does not expose whether authorization or entitlement validation failed", async () => {
    const handler = createProfessionalAccessRevocationStreamHandler({
      authenticate: vi.fn().mockResolvedValue({ id: 7 }),
      authorize: vi.fn().mockRejectedValue(new Error("revoked patient 41")),
      subscribe: vi.fn() as never,
      findPersistedRevocation: vi.fn().mockResolvedValue(null),
    });
    const req = request({ patientId: "41", resource: "professional_messages" });
    const res = response();

    await handler(req as unknown as Request, res as unknown as Response);

    expect(res.statusCode).toBe(503);
    expect(res.jsonBody).toEqual({
      error: "Professional access stream unavailable.",
    });
    expect(JSON.stringify(res.jsonBody)).not.toContain("41");
    expect(JSON.stringify(res.jsonBody)).not.toContain("revoked");
  });
});
