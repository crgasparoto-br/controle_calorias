import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  professionalLabel,
  ProfessionalAsyncState,
  ProfessionalStatusBadge,
} from "./ProfessionalUi";

describe("professional product labels", () => {
  it("maps domain states to consistent pt-BR labels", () => {
    expect(professionalLabel("authorization", "approved")).toBe("Aprovada");
    expect(professionalLabel("tracking", "paused")).toBe("Pausado");
    expect(professionalLabel("message", "failed")).toBe("Falha no envio");
    expect(professionalLabel("severity", "urgent")).toBe("Urgente");
    expect(professionalLabel("origin", "ai_suggested")).toBe(
      "Sugestão da IA revisada"
    );
  });

  it("uses a safe label for unknown values", () => {
    expect(professionalLabel("message", "internal_future_state")).toBe(
      "Não informado"
    );
  });
});

describe("shared professional states", () => {
  it("renders text together with semantic status", () => {
    const html = renderToString(
      <ProfessionalStatusBadge kind="severity" value="attention" />
    );
    expect(html).toContain("Atenção");
    expect(html).toContain("svg");
  });

  it("announces recoverable errors and retry", () => {
    const html = renderToString(
      <ProfessionalAsyncState
        title="Não foi possível carregar"
        description="Tente novamente."
        onRetry={() => undefined}
      />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Tentar novamente");
  });
});
