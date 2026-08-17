import { describe, expect, it, vi } from "vitest";
import { startProcessingAcknowledgement } from "./processingAcknowledgement";

describe("processingAcknowledgement", () => {
  it("cancela o acknowledgement quando a resposta final fica pronta antes do limiar", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => ({ ok: true, detail: "ok" }));
    const coordinator = startProcessingAcknowledgement({ send, delayMs: 100 });

    await coordinator.beforeFinalReply();
    await vi.advanceTimersByTimeAsync(200);

    expect(send).not.toHaveBeenCalled();
    expect(coordinator.state()).toBe("cancelled");
    vi.useRealTimers();
  });

  it("envia no máximo um acknowledgement no caminho lento", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => ({ ok: true, detail: "ok" }));
    const coordinator = startProcessingAcknowledgement({ send, delayMs: 100 });

    await vi.advanceTimersByTimeAsync(100);
    await coordinator.beforeFinalReply();
    await vi.advanceTimersByTimeAsync(500);

    expect(send).toHaveBeenCalledTimes(1);
    expect(coordinator.state()).toBe("sent");
    vi.useRealTimers();
  });

  it("aguarda o acknowledgement que já começou antes de liberar a resposta final", async () => {
    vi.useFakeTimers();
    let resolveSend!: () => void;
    const send = vi.fn(() => new Promise<{ ok: boolean; detail: string }>(resolve => {
      resolveSend = () => resolve({ ok: true, detail: "ok" });
    }));
    const coordinator = startProcessingAcknowledgement({ send, delayMs: 100 });

    await vi.advanceTimersByTimeAsync(100);
    let finalReleased = false;
    const beforeFinal = coordinator.beforeFinalReply().then(() => { finalReleased = true; });
    await Promise.resolve();
    expect(finalReleased).toBe(false);

    resolveSend();
    await beforeFinal;
    expect(finalReleased).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("registra falha operacional sem bloquear a resposta final", async () => {
    vi.useFakeTimers();
    const onFailure = vi.fn(async () => {});
    const coordinator = startProcessingAcknowledgement({
      send: async () => ({ ok: false, detail: "Meta indisponível" }),
      onFailure,
      delayMs: 100,
    });

    await vi.advanceTimersByTimeAsync(100);
    await coordinator.beforeFinalReply();

    expect(onFailure).toHaveBeenCalledWith("Meta indisponível");
    expect(coordinator.state()).toBe("sent");
    vi.useRealTimers();
  });
});
