import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PROFESSIONAL_ENTITLEMENT_RESOURCES } from "@shared/professionalEntitlements";
import {
  professionalLabel,
  professionalLabels,
  ProfessionalAsyncState,
  ProfessionalPatientHeader,
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

  it("covers every canonical professional entitlement with a product label", () => {
    expect(Object.keys(professionalLabels.entitlement).sort()).toEqual(
      [...PROFESSIONAL_ENTITLEMENT_RESOURCES].sort()
    );
    for (const resource of PROFESSIONAL_ENTITLEMENT_RESOURCES) {
      expect(professionalLabel("entitlement", resource)).not.toBe(
        "Não informado"
      );
      expect(professionalLabel("entitlement", resource)).not.toContain(
        "professional_"
      );
    }
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

  it("describes ended tracking without presenting it as active", () => {
    const html = renderToString(
      <ProfessionalPatientHeader
        actions={<button type="button">Ver histórico</button>}
        authorizationStatus="approved"
        displayName="Ana"
        trackingStatus="ended"
      />
    );
    expect(html).toContain("Acompanhamento encerrado");
    expect(html).toContain("Encerrado");
    expect(html).toContain("Ver histórico");
    expect(html).not.toContain("Paciente em acompanhamento");
    expect(html).not.toContain("Última atividade");
    expect(html).not.toContain("Próxima revisão");
  });

  it("shows the activity meaning before its timestamp", () => {
    const html = renderToString(
      <ProfessionalPatientHeader
        authorizationStatus="approved"
        displayName="Ana"
        trackingStatus="active"
        lastActivityLabel="Revisão da meta oficial solicitada"
        lastActivityAt={Date.UTC(2026, 6, 24, 15, 30)}
      />
    );
    expect(html).toContain("Revisão da meta oficial solicitada");
    expect(html).toContain("24/07/2026");
    expect(html.indexOf("Revisão da meta oficial solicitada")).toBeLessThan(
      html.indexOf("24/07/2026")
    );
  });

  it("describes paused tracking explicitly", () => {
    const html = renderToString(
      <ProfessionalPatientHeader
        authorizationStatus="approved"
        displayName="Ana"
        trackingStatus="paused"
      />
    );
    expect(html).toContain("Acompanhamento pausado");
    expect(html).toContain("Pausado");
  });

  it("does not infer authorization or tracking when domain values are absent", () => {
    const html = renderToString(
      <ProfessionalPatientHeader
        authorizationStatus={null}
        displayName="Ana"
        trackingStatus={null}
      />
    );
    expect(html).toContain("Situação do acompanhamento não informada");
    expect(html.match(/Não informado/g)).toHaveLength(3);
    expect(html).not.toContain("Aprovada");
    expect(html).not.toContain("Acompanhamento não iniciado");
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
