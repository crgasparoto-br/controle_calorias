import { describe, expect, it, vi } from "vitest";
import { exposeHttpAvailabilityBeforeBackgroundTasks } from "./runtimeAvailability";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("runtime availability bootstrap", () => {
  it("does not start non-critical work before HTTP availability is confirmed", async () => {
    const listening = deferred();
    const order: string[] = [];
    const task = vi.fn(async () => {
      order.push("background-task");
    });

    const bootstrap = exposeHttpAvailabilityBeforeBackgroundTasks({
      listen: async () => {
        order.push("listen-started");
        await listening.promise;
        order.push("listen-ready");
      },
      onReady: () => order.push("http-ready"),
      tasks: [
        {
          name: "food-catalog-sync",
          run: task,
          onError: vi.fn(),
        },
      ],
    });

    await Promise.resolve();
    expect(task).not.toHaveBeenCalled();
    expect(order).toEqual(["listen-started"]);

    listening.resolve();
    await bootstrap;
    await Promise.resolve();

    expect(task).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      "listen-started",
      "listen-ready",
      "http-ready",
      "background-task",
    ]);
  });

  it("keeps HTTP bootstrap successful when a non-critical task fails", async () => {
    const onError = vi.fn();

    await expect(
      exposeHttpAvailabilityBeforeBackgroundTasks({
        listen: async () => {},
        onReady: () => {},
        tasks: [
          {
            name: "food-catalog-sync",
            run: async () => {
              throw new Error("sync failed");
            },
            onError,
          },
        ],
      }),
    ).resolves.toBeUndefined();

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ message: "sync failed" }));
  });
});
