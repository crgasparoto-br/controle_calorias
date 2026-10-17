import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findFoodStaticCandidates } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";
const inspect = (content: string, file = "server/modules/whatsapp/foodAssistant.ts") =>
  findFoodStaticCandidates([{ path: file, content }]);

describe("AUD1300 local food suggestion tables", () => {
  it("blocks a new lower-case local food menu and does not rely on the symbol name", () => {
    const content = [
      "export function suggest(meal: string) {",
      "const optionsByContext = {",
      " breakfast: [\"Iogurte com banana e aveia\", \"Ovos mexidos com pão\"],",
      " lunch: [\"Arroz com feijão e frango\", \"Carne magra e batata\"],",
      "}; return optionsByContext[meal]; }",
    ].join("\n");
    const findings = inspect(content).filter(f => f.ruleId === "17" &&
      f.symbol === "optionsByContext:meal-choice-catalog");
    expect(findings).toHaveLength(1);
    expect(evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-16T00:00:00Z"))
      .errors.length).toBeGreaterThan(0);
  });
  it("detects the existing production food assistant options", () => {
    const source = readFileSync(path.resolve(process.cwd(),
      "server/modules/whatsapp/foodAssistant.ts"), "utf8");
    const findings = inspect(source);
    expect(findings.some(f => f.ruleId === "17" &&
      f.symbol === "optionsByContext:meal-choice-catalog")).toBe(true);
  });
  it("does not classify status actions in a meal UI as food-specific knowledge", () => {
    const findings = inspect(
      "const optionsByContext = {breakfast:[\"Editar\",\"Excluir\"],lunch:[\"Editar\",\"Excluir\"]};",
      "client/src/features/mealDashboard.tsx");
    expect(findings.filter(f => f.ruleId === "17" &&
      f.symbol.includes("meal-choice-catalog"))).toEqual([]);
  });
  it("blocks a single-meal static menu even for novel foods", () => {
    const findings = inspect(`export function suggestMeal(meal: string) {
      const optionsByContext = { lunch: ["Quinoa com cogumelos", "Tofu grelhado com lentilhas"] };
      return optionsByContext[meal as "lunch"];
    }`);
    expect(findings.some(f => f.ruleId === "17" &&
      f.symbol === "optionsByContext:meal-choice-catalog")).toBe(true);
    expect(evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-16T00:00:00Z"))
      .errors.length).toBeGreaterThan(0);
  });
  it("does not treat multiword menu actions as food suggestions even under suggestMeal", () => {
    const findings = inspect(`export function suggestMeal(meal: string) {
      const optionsByContext = { lunch: ["Editar item", "Excluir item"] };
      return optionsByContext[meal as "lunch"];
    }`);
    expect(findings.filter(f => f.symbol.includes("meal-choice-catalog"))).toEqual([]);
  });
  it("still detects preparation-based suggestions without foods in the lexical seed", () => {
    const findings = inspect(`export function suggestMeal(meal: string) {
      const optionsByContext = { lunch: ["Quinoa com cogumelos", "Tofu grelhado com lentilhas"] };
      return optionsByContext[meal as "lunch"];
    }`);
    expect(findings.some(f => f.ruleId === "17" &&
      f.symbol.includes("meal-choice-catalog"))).toBe(true);
  });
  it("does not classify single-context UI status choices as food knowledge", () => {
    const findings = inspect(`export function mealDashboard(meal: string) {
      const optionsByContext = { lunch: ["Editar item", "Excluir item"] };
      return optionsByContext[meal as "lunch"];
    }`);
    expect(findings.filter(f => f.symbol.includes("meal-choice-catalog"))).toEqual([]);
  });
  it("does not classify an unconsumed suggestion-looking dictionary", () => {
    const findings = inspect(`export function suggestMeal() {
      const optionsByContext = { lunch: ["Quinoa com cogumelos", "Tofu grelhado"] };
      return "none";
    }`);
    expect(findings.filter(f => f.symbol.includes("meal-choice-catalog"))).toEqual([]);
  });

  it("does not classify a non-meal indexed dictionary as meal knowledge", () => {
    const findings = inspect(
      "const optionsByContext = {account:[\"Banana e aveia\",\"Pão e ovo\"],status:[\"Arroz e feijão\",\"Batata e frango\"]};",
      "server/account.ts");
    expect(findings.filter(f => f.ruleId === "17" &&
      f.symbol.includes("meal-choice-catalog"))).toEqual([]);
  });
});

/** AUD1300-20261017-F36: link literal knowledge to the productive consumer,
 * not to the declaration's enclosing function or its filename. */
describe("AUD1300 F36 module and function-level meal-choice provenance", () => {
  type File = { path: string; content: string };
  const table = 'const optionsByContext = { breakfast: ["pitaya", "cupuaçu"] };';
  const check = (files: File[], expected: boolean, origin: string): void => {
    const findings = findFoodStaticCandidates(files);
    const choices = findings.filter(f => f.ruleId === "17" &&
      f.symbol.endsWith(":meal-choice-catalog") && f.file === origin);
    expect(choices.length > 0).toBe(expected);
    const verdict = evaluateFoodArchitectureGate(findings, [], [],
      new Date("2026-10-17T14:00:00Z"));
    expect(verdict.errors.length > 0).toBe(expected);
  };

  it("blocks a module-scope catalog consumed by a sibling recommendation", () => {
    check([{ path: "server/mealService.ts", content: `${table}
      export function recommendMeal(meal: string) { return optionsByContext[meal] ?? []; }` }],
    true, "server/mealService.ts");
  });
  it("does not miss an explicit general meal context", () => {
    check([{ path: "server/mealService.ts", content: `const optionsByContext = {
      general: ["pitaya", "cupuaçu"] };
      export function recommendMeal(meal: string) { return optionsByContext[meal]; }` }],
    true, "server/mealService.ts");
  });
  it("blocks a module-scope catalog through an immutable local alias", () => {
    check([{ path: "server/mealService.ts", content: `${table}
      function recommendMeal(meal: string) { const choices = optionsByContext; return choices[meal]; }` }],
    true, "server/mealService.ts");
  });
  it("blocks helper delegation to the catalog even when the helper is not named food", () => {
    check([{ path: "server/mealService.ts", content: `${table}
      const optionsFor = (meal: string) => optionsByContext[meal] ?? [];
      export function recommendMeal(meal: string) { return optionsFor(meal); }` }],
    true, "server/mealService.ts");
  });
  it("blocks a module-level catalog imported under an alias", () => {
    check([
      { path: "server/mealChoices.ts", content: `export ${table}` },
      { path: "server/mealService.ts", content: `import { optionsByContext as choices } from "./mealChoices";
        export function recommendMeal(meal: string) { return choices[meal]; }` },
    ], true, "server/mealChoices.ts");
  });
  it("blocks a re-exported catalog used through a namespace import", () => {
    check([
      { path: "server/mealChoices.ts", content: `export ${table}` },
      { path: "server/foodChoices/index.ts", content: 'export { optionsByContext as menu } from "../mealChoices";' },
      { path: "server/mealService.ts", content: `import * as source from "./foodChoices";
        export function recommendMeal(meal: string) { return source.menu[meal]; }` },
    ], true, "server/mealChoices.ts");
  });
  it("blocks a catalog reached through an imported helper function", () => {
    check([
      { path: "server/mealChoices.ts", content: `${table}
        export function choiceFor(meal: string) { return optionsByContext[meal] ?? []; }` },
      { path: "server/mealService.ts", content: `import { choiceFor as lookup } from "./mealChoices";
        export function recommendMeal(meal: string) { return lookup(meal); }` },
    ], true, "server/mealChoices.ts");
  });
  it("blocks a catalog inside a generic helper reached by a recommendation", () => {
    check([{ path: "server/mealService.ts", content: `function choiceFor(meal: string) {
      ${table} return optionsByContext[meal]; }
      export function recommendMeal(meal: string) { return choiceFor(meal); }` }],
    true, "server/mealService.ts");
  });
  it("recognizes a catalog frozen with Object.freeze, preserving prior behavior", () => {
    check([{ path: "server/mealService.ts", content: `const optionsByContext = Object.freeze({
      breakfast: ["pitaya", "cupuaçu"] });
      export function recommendMeal(meal: string) { return optionsByContext[meal]; }` }],
    true, "server/mealService.ts");
  });
  it("does not attribute a shadowed imported constant to the origin catalog", () => {
    check([
      { path: "server/mealChoices.ts", content: `export ${table}` },
      { path: "server/mealService.ts", content: `import { optionsByContext } from "./mealChoices";
        export function recommendMeal(meal: string, optionsByContext: Record<string,string[]>) {
          return optionsByContext[meal]; }` },
    ], false, "server/mealChoices.ts");
  });
  it("does not classify a module-level catalog not consumed by the recommendation", () => {
    check([{ path: "server/mealService.ts", content: `${table}
      export function recommendMeal(meal: string) { return getFoodFromDatabase(meal); }` }],
    false, "server/mealService.ts");
  });
  it("does not block UI actions even when recommended from a meal function", () => {
    check([{ path: "server/mealService.ts", content: `const optionsByContext = {
      breakfast: ["Editar item", "Excluir item"] };
      export function recommendMeal(meal: string) { return optionsByContext[meal]; }` }],
    false, "server/mealService.ts");
  });
  it("does not classify an unrelated account status helper", () => {
    check([{ path: "server/account/status.ts", content: `const optionsByContext = {
      general: ["Ativo", "Pendente"] };
      export function suggestAccountStatus(value: string) { return optionsByContext[value]; }` }],
    false, "server/account/status.ts");
  });
  it("does not follow type-only imports or inert references", () => {
    check([
      { path: "server/mealChoices.ts", content: `export ${table}` },
      { path: "server/mealService.ts", content: `import type { optionsByContext } from "./mealChoices";
        export function recommendMeal(meal: string) { return fromDb(meal); }` },
    ], false, "server/mealChoices.ts");
  });
  it("does not associate a runtime-fetched catalog with a static literal", () => {
    check([{ path: "server/mealService.ts", content: `const optionsByContext = loadGovernedFoodData();
      export function recommendMeal(meal: string) { return optionsByContext[meal]; }` }],
    false, "server/mealService.ts");
  });
});

/** AUD1300-F41: novel context identifiers cannot bypass the productive food gate. */
describe("AUD1300 F41 context-key independence", () => {
  type File = { path: string; content: string };
  const scan = (files: File[], origin = files[0]!.path) =>
    findFoodStaticCandidates(files).filter(f => f.ruleId === "17" &&
      f.file === origin && f.symbol.endsWith(":meal-choice-catalog"));
  const block = (files: File[], origin = files[0]!.path) => {
    const findings = scan(files, origin);
    expect(findings).toHaveLength(1);
    expect(evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-17T12:00:00Z"))
      .errors.some(error => error.includes("New food architecture violation gate 17"))).toBe(true);
  };

  it("blocks the exact audited typed menu with a known and unknown context", () => {
    block([{ path: "server/modules/meals/service.ts", content: `export function recommendMeal(context: string) {
      const optionsByContext: Record<string, string[]> = {
        breakfast: ["Aveia com banana"],
        brunch: ["Ovos com abacate"],
      };
      return optionsByContext[context] ?? [];
    }` }]);
  });

  it("blocks catalogs containing only new context keys, including computed use", () => {
    block([{ path: "server/mealService.ts", content: `export function suggestMeal(context: string) {
      const optionsByContext = {
        merenda: ["Pão com ricota"],
        iftar: ["Grão-de-bico com arroz"],
      };
      return optionsByContext[context as "merenda" | "iftar"];
    }` }]);
  });

  it("blocks a Unicode-only context identifier without known meal keys", () => {
    block([{ path: "server/mealService.ts", content: `export function recommendMeal(context: string) {
      const optionsByContext = { refeiçãoEspecial: ["Arroz com lentilhas"] };
      return optionsByContext[context as "refeiçãoEspecial"];
    }` }]);
  });

  it("follows an imported catalog with previously unknown context names", () => {
    block([
      { path: "server/mealChoices.ts", content: `export const optionsByContext = {
        brunch: ["Tofu com lentilhas"],
        merenda: ["Iogurte com aveia"],
      };` },
      { path: "server/mealService.ts", content: `import { optionsByContext as choices } from "./mealChoices";
        export function recommendMeal() { return choices["brunch"]; }` },
    ], "server/mealChoices.ts");
  });

  it("follows destructured unknown keys through a productive import", () => {
    block([
      { path: "server/mealChoices.ts", content: `export const optionsByContext = {
        brunch: ["Ovos com abacate"],
      };` },
      { path: "server/mealService.ts", content: `import { optionsByContext as choices } from "./mealChoices";
        export function recommendMeal() { const { brunch } = choices; return brunch; }` },
    ], "server/mealChoices.ts");
  });

  it("does not attribute novel-key administrative status data to food knowledge", () => {
    expect(scan([{ path: "server/account.ts", content: `const optionsByContext = {
      onboarding: ["Pendente", "Aprovado"],
      cobrança: ["Pago", "Em aberto"],
    };
    export function recommendAccountStatus(context: string) { return optionsByContext[context]; }` }])).toEqual([]);
  });

  it("preserves negative controls for UI actions and unused catalogs", () => {
    expect(scan([{ path: "server/mealService.ts", content: `export function suggestMeal(context: string) {
      const optionsByContext = { brunch: ["Editar item", "Excluir item"] };
      return optionsByContext[context as "brunch"];
    }` }])).toEqual([]);
    expect(scan([{ path: "server/mealService.ts", content: `export function suggestMeal() {
      const optionsByContext = { brunch: ["Ovos com abacate"] };
      return loadGovernedFoodData();
    }` }])).toEqual([]);
  });
});

/** AUD1300-20261017-F42: computed context property names may not evade gate 17. */
describe("AUD1300 F42 computed meal context property names", () => {
  type File = { path: string; content: string };
  const scan = (files: File[], source = files[0]!.path) =>
    findFoodStaticCandidates(files).filter(f => f.ruleId === "17" &&
      f.file === source && f.symbol.endsWith(":meal-choice-catalog"));
  const expectBlocked = (files: File[], source = files[0]!.path) => {
    const findings = scan(files, source);
    expect(findings).toHaveLength(1);
    const verdict = evaluateFoodArchitectureGate(findings, [], [],
      new Date("2026-10-17T19:30:00Z"));
    expect(verdict.errors.some(error =>
      error.includes("New food architecture violation gate 17"))).toBe(true);
  };

  it("blocks the audited computed literal key with a productive menu", () => {
    expectBlocked([{ path: "server/modules/meals/service.ts", content:
      'export function recommendMeal(context: string) { ' +
      'const optionsByContext = { ["brunch"]: ["Ovos com abacate"] }; ' +
      'return optionsByContext[context] ?? []; }' }]);
  });

  it("blocks computed template literal and unknown Unicode contexts", () => {
    const source = [
      "export function suggestMeal(context: string) {",
      "  const optionsByContext = {",
      "    [`merenda`]: [\"Iogurte com aveia\"],",
      "    [\"refeiçãoEspecial\"]: [\"Arroz com lentilhas\"],",
      "  };",
      "  return optionsByContext[context];",
      "}",
    ].join("\n");
    expectBlocked([{ path: "server/mealService.ts", content: source }]);
  });

  it("preserves the original source on imported computed keys", () => {
    expectBlocked([
      { path: "server/mealChoices.ts", content:
        'export const optionsByContext = { ["brunch"]: ["Ovos com aveia"] };' },
      { path: "server/mealService.ts", content:
        'import { optionsByContext as choices } from "./mealChoices"; ' +
        'export function recommendMeal() { return choices["brunch"]; }' },
    ], "server/mealChoices.ts");
  });

  it("blocks a dynamic computed context when the options are still static food data", () => {
    expectBlocked([{ path: "server/mealService.ts", content:
      'export function recommendMeal(context: string) { ' +
      'const optionsByContext = { [context]: ["Grão-de-bico com arroz"] }; ' +
      'return optionsByContext[context]; }' }]);
  });

  it("does not block computed UI actions presented by a meal menu", () => {
    expect(scan([{ path: "server/mealService.ts", content:
      'export function recommendMeal(context: string) { ' +
      'const optionsByContext = { ["brunch"]: ["Editar item", "Excluir item"] }; ' +
      'return optionsByContext[context]; }' }])).toEqual([]);
  });

  it("does not block a computed status catalog with an administrative consumer", () => {
    expect(scan([{ path: "server/account/status.ts", content:
      'const optionsByContext = { ["brunch"]: ["Ativo", "Pendente"] }; ' +
      'export function recommendAccountStatus(context: string) { ' +
      'return optionsByContext[context]; }' }])).toEqual([]);
  });

  it("does not block a computed catalog unused by the productive consumer", () => {
    expect(scan([{ path: "server/mealService.ts", content:
      'export function recommendMeal(context: string) { ' +
      'const optionsByContext = { ["brunch"]: ["Ovos com aveia"] }; ' +
      'return loadGovernedFoodData(context); }' }])).toEqual([]);
  });
});
