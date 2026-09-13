export type NonCriticalStartupTask = {
  name: string;
  run: () => Promise<unknown> | unknown;
  onError: (error: unknown) => void;
};

export async function exposeHttpAvailabilityBeforeBackgroundTasks(input: {
  listen: () => Promise<void>;
  onReady: () => void;
  tasks: NonCriticalStartupTask[];
}) {
  await input.listen();
  input.onReady();

  for (const task of input.tasks) {
    void Promise.resolve()
      .then(() => task.run())
      .catch(error => task.onError(error));
  }
}
