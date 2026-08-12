export type AsaasEnvironment = "sandbox" | "production";

export type AsaasFetch = typeof fetch;

export class AsaasHttpError extends Error {
  readonly status: number;
  readonly codes: string[];

  constructor(status: number, codes: string[] = []) {
    super(`asaas_http_${status}${codes.length ? `:${codes.join(",")}` : ""}`);
    this.name = "AsaasHttpError";
    this.status = status;
    this.codes = codes;
  }
}

export class AsaasUncertainOutcomeError extends Error {
  constructor(message = "asaas_outcome_unknown") {
    super(message);
    this.name = "AsaasUncertainOutcomeError";
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
};

function errorCodes(payload: unknown): string[] {
  if (!payload || typeof payload !== "object" || !("errors" in payload)) return [];
  const errors = (payload as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];
  return errors
    .map(item =>
      item && typeof item === "object" && "code" in item
        ? String((item as { code?: unknown }).code ?? "")
        : ""
    )
    .filter(Boolean)
    .slice(0, 10);
}

export function createAsaasClient(input: {
  environment: AsaasEnvironment;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: AsaasFetch;
}) {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("asaas_api_key_required");
  const baseUrl =
    input.environment === "production"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";
  const timeoutMs = Math.max(1_000, input.timeoutMs ?? 60_000);
  const fetchImpl = input.fetchImpl ?? fetch;

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method,
        headers: {
          accept: "application/json",
          access_token: apiKey,
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: unknown = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }
      if (!response.ok) throw new AsaasHttpError(response.status, errorCodes(payload));
      if (
        method === "POST" &&
        url.pathname.endsWith("/checkouts") &&
        payload &&
        typeof payload === "object" &&
        !Array.isArray(payload)
      ) {
        const checkout = payload as { id?: unknown; link?: unknown };
        const checkoutId = typeof checkout.id === "string" ? checkout.id.trim() : "";
        const checkoutLink = typeof checkout.link === "string" ? checkout.link.trim() : "";
        if (checkoutId && !checkoutLink) {
          const checkoutUrl = new URL("https://asaas.com/checkoutSession/show");
          checkoutUrl.searchParams.set("id", checkoutId);
          payload = { ...checkout, link: checkoutUrl.toString() };
        }
      }
      return payload as T;
    } catch (error) {
      if (error instanceof AsaasHttpError) throw error;
      if (method !== "GET") throw new AsaasUncertainOutcomeError();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    request,
    get<T>(path: string, query?: RequestOptions["query"]) {
      return request<T>(path, { method: "GET", query });
    },
    post<T>(path: string, body: unknown) {
      return request<T>(path, { method: "POST", body });
    },
    put<T>(path: string, body: unknown) {
      return request<T>(path, { method: "PUT", body });
    },
    delete<T>(path: string) {
      return request<T>(path, { method: "DELETE" });
    },
  };
}

export type AsaasClient = ReturnType<typeof createAsaasClient>;
