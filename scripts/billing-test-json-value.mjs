globalThis.jsonValue = value =>
  typeof value === "string" ? JSON.parse(value) : value;
