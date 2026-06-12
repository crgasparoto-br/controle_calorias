import { describe, expect, it } from "vitest";
import { shouldShowWhatsappGreetingBlock } from "./ProfileWhatsappGreetingVisibility";

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
