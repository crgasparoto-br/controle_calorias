// @vitest-environment jsdom
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProfessionalAccessRevocationStream } from "./useProfessionalAccessRevocationStream";

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readonly withCredentials: boolean;
  close = vi.fn();

  constructor(url: string | URL, init?: EventSourceInit) {
    super();
    this.url = String(url);
    this.withCredentials = Boolean(init?.withCredentials);
    FakeEventSource.instances.push(this);
  }

  emitRevocation(payload: unknown) {
    this.dispatchEvent(
      new MessageEvent("access_revoked", { data: JSON.stringify(payload) })
    );
  }
}

function Harness({ onRevoked }: { onRevoked: (payload: any) => void }) {
  useProfessionalAccessRevocationStream({
    enabled: true,
    patientId: 41,
    resource: "professional_reports",
    onRevoked,
  });
  return null;
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useProfessionalAccessRevocationStream", () => {
  it("opens an authenticated patient-scoped stream and forwards matching revocation", async () => {
    const onRevoked = vi.fn();
    render(<Harness onRevoked={onRevoked} />);

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];
    expect(source.url).toContain("patientId=41");
    expect(source.url).toContain("resource=professional_reports");
    expect(source.withCredentials).toBe(true);

    source.emitRevocation({ patientId: 41, occurredAt: 123 });
    expect(onRevoked).toHaveBeenCalledWith({ patientId: 41, occurredAt: 123 });
  });

  it("ignores malformed or cross-patient events and closes on unmount", async () => {
    const onRevoked = vi.fn();
    const view = render(<Harness onRevoked={onRevoked} />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];

    source.emitRevocation({ patientId: 72, occurredAt: 123 });
    source.dispatchEvent(new MessageEvent("access_revoked", { data: "{" }));
    expect(onRevoked).not.toHaveBeenCalled();

    view.unmount();
    expect(source.close).toHaveBeenCalledTimes(1);
  });
});
