import { describe, expect, it } from "vitest";
import { findTimeZoneArchitectureViolations } from "./timezone-architecture";

function violations(path: string, content: string) {
  return findTimeZoneArchitectureViolations([{ path, content }]);
}

describe("timezone architecture guard", () => {
  it("bloqueia fallback local de São Paulo", () => {
    expect(violations("server/example.ts", 'const zone = "America/Sao_Paulo";')).toEqual([
      expect.stringContaining("Fallback funcional"),
    ]);
  });

  it("bloqueia timezone do navegador como autoridade", () => {
    expect(violations("client/src/example.ts", "const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;")).toEqual([
      expect.stringContaining("Timezone do navegador"),
    ]);
  });

  it("bloqueia limite local concatenado como UTC", () => {
    expect(violations("server/example.ts", "const start = new Date(`${date}T00:00:00Z`);")).toEqual([
      expect.stringContaining("concatenação UTC fixa"),
    ]);
  });

  it("bloqueia resolver paralelo e cálculo manual de offset", () => {
    const result = violations("server/example.ts", `
      function getZonedParts(date: Date, timeZone: string) { return date; }
      const offsetMinutes = Date.UTC(2026, 0, 1);
    `);
    expect(result).toEqual(expect.arrayContaining([
      expect.stringContaining("Resolver ou conversor paralelo"),
      expect.stringContaining("Cálculo manual de offset"),
    ]));
  });

  it("bloqueia resolução de perfil dentro de loop", () => {
    expect(violations("server/example.ts", `
      for (const item of items) {
        await resolveEffectiveUserTimeZone(item.userId);
      }
    `)).toEqual([
      expect.stringContaining("potencialmente N+1"),
    ]);
  });

  it("bloqueia occurredAt absoluto em contrato público temporal", () => {
    expect(violations("server/modules/quickEdit/schemas.ts", `
      const quickEditMealMutationSchema = z.object({ occurredAt: z.string() });
    `)).toEqual([
      expect.stringContaining("Contrato público temporal aceita occurredAt absoluto"),
    ]);
  });

  it("bloqueia schema temporal absoluto na confirmação pública de foto", () => {
    expect(violations("server/nutritionRouter.ts", `
      confirm: protectedProcedure.input(confirmFoodPhotoAnalysisSchema).mutation(handler),
    `)).toEqual([
      expect.stringContaining("Confirmação pública de foto"),
    ]);
  });

  it("permite o contrato central, fixtures e formatação explícita", () => {
    expect(findTimeZoneArchitectureViolations([
      { path: "shared/timeZone.ts", content: 'export const DEFAULT_APP_TIME_ZONE = "America/Sao_Paulo";' },
      { path: "server/example.test.ts", content: 'const zone = "America/Sao_Paulo";' },
      { path: "server/example.ts", content: 'new Intl.DateTimeFormat("pt-BR", { timeZone }).format(date);' },
      { path: "client/src/lib/dateTime.ts", content: "export function zonedDateTimeLocalToIso(value: string, timeZone: string) { return value + timeZone; }" },
    ])).toEqual([]);
  });
});
