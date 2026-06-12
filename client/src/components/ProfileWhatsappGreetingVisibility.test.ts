import { describe, expect, it } from "vitest";
import { isWhatsappGreetingSettingsRoute, shouldShowWhatsappGreetingBlock } from "./ProfileWhatsappGreetingVisibility";

describe("shouldShowWhatsappGreetingBlock", () => {
  it("oculta a saudação no Perfil para usuário sem perfil profissional ativo", () => {
    expect(shouldShowWhatsappGreetingBlock({
      isSettingsRoute: true,
      hasActiveProfessionalProfile: false,
      hasGreetingCardContext: true,
    })).toBe(false);
  });

  it("exibe a saudação no Perfil para usuário profissional ativo", () => {
    expect(shouldShowWhatsappGreetingBlock({
      isSettingsRoute: true,
      hasActiveProfessionalProfile: true,
      hasGreetingCardContext: true,
    })).toBe(true);
  });

  it("mantém a saudação oculta fora de Configurações", () => {
    expect(shouldShowWhatsappGreetingBlock({
      isSettingsRoute: false,
      hasActiveProfessionalProfile: true,
      hasGreetingCardContext: true,
    })).toBe(false);
  });
});

describe("isWhatsappGreetingSettingsRoute", () => {
  it("habilita a regra apenas em Configurações e onboarding interno", () => {
    expect(isWhatsappGreetingSettingsRoute("/settings")).toBe(true);
    expect(isWhatsappGreetingSettingsRoute("/onboarding")).toBe(true);
  });

  it("mantém rotas públicas sem consulta protegida de perfil profissional", () => {
    expect(isWhatsappGreetingSettingsRoute("/quick-edit/token-publico")).toBe(false);
    expect(isWhatsappGreetingSettingsRoute("/onboarding/whatsapp/token-publico")).toBe(false);
    expect(isWhatsappGreetingSettingsRoute("/login")).toBe(false);
  });
});
