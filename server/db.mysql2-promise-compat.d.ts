declare module "mysql2/promise" {
  interface Pool {
    promise(promiseImpl?: PromiseConstructor): Pool;
  }
}

export {};
