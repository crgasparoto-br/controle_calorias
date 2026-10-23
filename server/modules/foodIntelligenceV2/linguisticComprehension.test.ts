import { describe, expect, it, vi } from "vitest";
import { comprehendFoodLanguage, splitFoodSurface } from "./linguisticComprehension";
import type { GovernedLexiconEntry, LinguisticLexiconStore, LinguisticRequest } from "./linguisticComprehension";

const base: LinguisticRequest = {
  rawText: "um ovo cozido", sourceRef: "turn:1304:text", modality: "text",
  ownerUserId: 5, lexiconRevision: "rev-1",
};
const store = (entries: GovernedLexiconEntry[] = []): LinguisticLexiconStore => ({
  load: vi.fn(async () => entries),
});
const entry = (override: Partial<GovernedLexiconEntry> = {}): GovernedLexiconEntry => ({
  id: 10, term: "meu pão", normalizedTerm: "meu pao",
  kind: "alias_surface", targetType: "canonical_term", targetRef: "pão de forma",
  locale: "pt-BR", scope: "global", userId: null, source: null,
  status: "verified", confidence: 0.9, requiresClarification: false,
  current: true, validFrom: null, validTo: null,
  ...override,
});
const analyze = (rawText: string, entries: GovernedLexiconEntry[] = [], override: Partial<LinguisticRequest> = {}) =>
  comprehendFoodLanguage({ ...base, rawText, ...override }, store(entries));

describe("Camada de Compreensão Linguística #1304", () => {
  it("normaliza numeral independentemente de correção lexical do alimento", async () => {
    const [one] = await analyze("um ovo cozido");
    const [two] = await analyze("dois ovos cozidos");
    const [numeric] = await analyze("2 ovos cozidos");
    expect(one.quantityHints).toMatchObject({ value: 1, unit: "un" });
    expect(two.quantityHints).toMatchObject({ value: 2, unit: "un" });
    expect(numeric.quantityHints).toMatchObject({ value: 2, unit: "un" });
    expect(two.identityHints.foodName).toBe(numeric.identityHints.foodName);
    expect(one.identityHints.foodName).toBe("ovo cozido");
  });

  it("converge decimais escritos ou numéricos mantendo a unidade física", async () => {
    const [a] = await analyze("uma fatia e meia de mortadela");
    const [b] = await analyze("1,5 fatias de mortadela");
    const [c] = await analyze("1.5 fatias de mortadela");
    expect(a.quantityHints).toMatchObject({ value: 1.5, unit: "fatia" });
    expect(b.quantityHints).toMatchObject({ value: 1.5, unit: "fatia" });
    expect(c.quantityHints).toMatchObject({ value: 1.5, unit: "fatia" });
    expect([a, b, c].every(item => item.identityHints.foodName === "mortadela")).toBe(true);
  });

  it("preserva o mesmo alimento quando a operação canônica muda de posição", async () => {
    const phrases = [
      "Adicionar ao café da manhã 1,5 fatias de mortadela",
      "Adicionar 1,5 fatias de mortadela ao café da manhã",
      "No café da manhã comi uma fatia e meia de mortadela",
    ];
    const observations = await Promise.all(phrases.map(text => analyze(text)));
    expect(observations.map(([obs]) => ({
      food: obs.identityHints.foodName,
      value: obs.quantityHints.value,
      unit: obs.quantityHints.unit,
    }))).toEqual(Array(3).fill({ food: "mortadela", value: 1.5, unit: "fatia" }));
    for (let i = 0; i < phrases.length; i++) {
      const [obs] = observations[i];
      const span = obs.surfaceSpan.span!;
      expect(phrases[i].slice(span.start, span.end)).not.toMatch(/^(Adicionar|No café)/i);
      expect("mealOperation" in obs).toBe(false);
    }
  });

  it("mantém unidade após 'um e meio' e não converte volume em massa", async () => {
    const [observed] = await analyze("um e meio copo de leite");
    expect(observed.quantityHints).toMatchObject({ value: 1.5, unit: "copo" });
    expect(observed.identityHints.foodName).toBe("leite");
  });

  it("resolve flexão plural somente por evidência de léxico governado", async () => {
    const entries = [
      entry({ id: 81, normalizedTerm: "ovos cozidos", targetRef: "ovo cozido" }),
      entry({ id: 82, normalizedTerm: "ovo cozido", targetRef: "ovo cozido" }),
    ];
    const [a] = await analyze("2 ovos cozidos", entries);
    const [b] = await analyze("dois ovo cozido", entries);
    expect(a.identityHints.foodName).toBe("ovo cozido");
    expect(b.identityHints.foodName).toBe("ovo cozido");
    expect(a.quantityHints.value).toBe(b.quantityHints.value);
  });

  it("não transforma ml em g nem adivinha porção vaga ou número ambíguo", async () => {
    const [ml] = await analyze("250 ml de leite");
    const [vague] = await analyze("um punhado de amendoim");
    const [ambiguous] = await analyze("1.000 fatias de queijo");
    expect(ml.quantityHints).toMatchObject({ value: 250, unit: "ml" });
    expect(vague.unresolvedReason).toBe("unknown_surface");
    expect(ambiguous.quantityHints.value).toBeNull();
  });

  it("preserva os spans UTF-16 originais e separa lista sem quebrar decimal", async () => {
    const text = "🍳 dois ovos, 1,5 fatias de mortadela; uma banana";
    const spans = splitFoodSurface(text);
    expect(spans).toHaveLength(3);
    const found = await analyze(text);
    expect(found).toHaveLength(3);
    for (let i = 0; i < found.length; i++) {
      const span = found[i].surfaceSpan.span!;
      expect(found[i].rawInput).toBe(text);
      expect(text.slice(span.start, span.end)).toBe(spans[i].text);
    }
  });

  it("preserva acento e variações na evidência original, sem atribuir verificação", async () => {
    const [a] = await analyze("2 MACA");
    const [b] = await analyze("2 maçã");
    expect(a.identityHints.foodName).toBe(b.identityHints.foodName);
    expect(a.evidence[0].anchor.span).toEqual({ start: 0, end: 6 });
    expect(a.evidence.every(value => !value.verified)).toBe(true);
  });

  it("não transforma ingredientes e linhas de rótulo OCR em alimentos separados", async () => {
    const load = vi.fn(async () => []);
    const interpreter = vi.fn(async () => ({ alternatives: [] }));
    const input = "Ingredientes: arroz; milho, açúcar\nAlergênicos: leite";
    const [obs] = await comprehendFoodLanguage({
      ...base, rawText: input, modality: "image",
      imageRegionRole: "ingredients", imageRegion: { x: 0.1, y: 0.2, width: 0.5, height: 0.3 },
      shouldInterpretResidual: () => true, interpreterVersion: "s3-v1",
    }, { load }, interpreter);
    expect(obs.identityHints.foodName).toBeNull();
    expect(obs.quantityHints.value).toBeNull();
    expect(obs.evidence).toHaveLength(1);
    expect(obs.evidence[0].value).toBe(input);
    expect(obs.surfaceSpan.region).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.3 });
    expect(obs.unresolvedReason).toBe("unknown_surface");
    expect(load).not.toHaveBeenCalled();
    expect(interpreter).not.toHaveBeenCalled();
  });

  it("OCR sem região classificada não vira identidade por fallback", async () => {
    const [obs] = await comprehendFoodLanguage({
      ...base, rawText: "1 porção de pão", modality: "image",
    }, store());
    expect(obs.identityHints.foodName).toBeNull();
    expect(obs.evidence[0].origin).toBe("ocr");
  });

  it("marca locale diferente de pt-BR sem consultar léxico nem IA", async () => {
    const load = vi.fn(async () => []);
    const interpreter = vi.fn(async () => ({ alternatives: [] }));
    const [obs] = await comprehendFoodLanguage(
      { ...base, locale: "es-ES", shouldInterpretResidual: () => true },
      { load }, interpreter,
    );
    expect(obs.locale).toEqual({ requested: "es-ES", effective: null, status: "unsupported" });
    expect(obs.unresolvedReason).toBe("unsupported_locale");
    expect(load).not.toHaveBeenCalled();
    expect(interpreter).not.toHaveBeenCalled();
  });

  it("aplica léxico global rastreando ID, sem apagar evidência bruta", async () => {
    const [obs] = await analyze("meu pão", [entry()]);
    expect(obs.identityHints.foodName).toBe("pao de forma");
    expect(obs.normalizationPath.map(step => step.stage)).toEqual(["S1", "S2"]);
    expect(obs.normalizationPath[1].lexiconEntryId).toBe(10);
    expect(obs.evidence.some(item => item.value === "meu pao")).toBe(true);
  });

  it("o pessoal confirmado prevalece apenas para o proprietário autenticado", async () => {
    const global = entry({ id: 10, term: "cafezinho", normalizedTerm: "cafezinho", targetRef: "café" });
    const personal = entry({ id: 11, scope: "user", userId: 5, source: "user_confirmed",
      status: "active", term: "cafezinho", normalizedTerm: "cafezinho", targetRef: "café sem açúcar" });
    const [owned] = await analyze("cafezinho", [global, personal]);
    const [other] = await analyze("cafezinho", [global, personal], { ownerUserId: 9 });
    expect(owned.normalizationPath[1].lexiconEntryId).toBe(11);
    expect(owned.alternatives).toHaveLength(1); // material qualifier cannot be silently inserted
    expect(other.normalizationPath[1].lexiconEntryId).toBe(10);
    expect(other.alternatives).toHaveLength(0);
    expect(other.identityHints.foodName).toBe("cafe");
  });

  it("revogação, validade e importação não autorizam uma substituição", async () => {
    const rows = [
      entry({ id: 30, scope: "user", userId: 5, source: "imported", status: "active" }),
      entry({ id: 31, scope: "global", status: "revoked" }),
      entry({ id: 32, validTo: new Date("2020-01-01") }),
    ];
    const [obs] = await analyze("meu pão", rows);
    expect(obs.normalizationPath.map(step => step.stage)).toEqual(["S1"]);
    expect(obs.identityHints.foodName).toBe("meu pao");
  });

  it("colisões do mesmo escopo não são resolvidas pela ordem do array", async () => {
    const [obs] = await analyze("meu pão", [entry(), entry({ id: 19, targetRef: "outra coisa" })]);
    expect(obs.normalizationPath.map(step => step.stage)).toEqual(["S1", "S2", "S2"]);
    expect(obs.alternatives.map(item => item.identityHints.foodName)).toEqual(["pao de forma", "outra coisa"]);
    expect(obs.unresolvedReason).toBe("unknown_surface");
  });

  it("typo ou variante são apenas hipótese e não substituição silenciosa", async () => {
    const [obs] = await analyze("banco", [entry({ id: 41, term: "banco",
      normalizedTerm: "banco", kind: "typo", targetRef: "panco" })]);
    expect(obs.identityHints.foodName).toBe("banco");
    expect(obs.alternatives[0].identityHints.foodName).toBe("panco");
    expect(obs.unresolvedReason).toBe("unknown_surface");
  });

  it("qualificadores materiais explícitos não são invertidos pelo léxico", async () => {
    const [obs] = await analyze("café com açúcar", [entry({
      normalizedTerm: "cafe com acucar", term: "café com açúcar",
      targetRef: "café sem açúcar",
    })]);
    expect(obs.identityHints.foodName).toBe("cafe com acucar");
    expect(obs.identityHints.qualifiers[0].value).toBe("com açúcar");
    expect(obs.alternatives).toHaveLength(1);
    expect(obs.unresolvedReason).toBe("unknown_surface");
  });

  it("protege tokens comerciais governados contra substituição silenciosa", async () => {
    const items = [
      entry({ id: 60, normalizedTerm: "pao doritos", targetRef: "pão genérico" }),
      entry({ id: 61, kind: "protected_token", normalizedTerm: "doritos",
        term: "Doritos", targetType: "none", targetRef: null }),
    ];
    const [obs] = await analyze("pão Doritos", items);
    expect(obs.identityHints.foodName).toBe("pao doritos");
    expect(obs.alternatives).toHaveLength(1);
    expect(obs.normalizationPath[1].lexiconEntryId).toBe(60);
    expect(obs.unresolvedReason).toBe("unknown_surface");
  });

  it("S1 e S2 não acionam intérprete residual quando não houver política #1306", async () => {
    const interpreter = vi.fn(async () => ({ alternatives: [] }));
    await comprehendFoodLanguage({ ...base, rawText: "2 ovos" }, store(), interpreter);
    expect(interpreter).not.toHaveBeenCalled();
  });

  it("S3 opcional só acrescenta alternativas versionadas, sem selecionar identidade ou macros", async () => {
    const interpreter = vi.fn(async () => ({
      alternatives: [{ foodName: "Panco", confidence: 0.6 }, { foodName: "branco", confidence: 0.4 }],
    }));
    const [obs] = await comprehendFoodLanguage({
      ...base, rawText: "banco", shouldInterpretResidual: () => true, interpreterVersion: "s3-v1",
    }, store([entry({ normalizedTerm: "banco", term: "banco", kind: "typo", targetRef: "branco" })]), interpreter);
    expect(interpreter).toHaveBeenCalledTimes(1);
    expect(obs.identityHints.foodName).toBe("banco");
    expect(obs.alternatives.length).toBeGreaterThanOrEqual(2);
    expect(obs.normalizationPath.at(-1)?.stage).toBe("S3");
    expect(obs.evidence.some(e => e.origin === "ai_estimate" && e.verified)).toBe(false);
    expect(obs.interpreterVersion).toBe("s3-v1");
  });

  it("payload de S3 inválido nunca autoriza outra identidade ou macros", async () => {
    const [obs] = await comprehendFoodLanguage({
      ...base, rawText: "banco", shouldInterpretResidual: () => true, interpreterVersion: "s3-v1",
    }, store([entry({ normalizedTerm: "banco", term: "banco", kind: "typo", targetRef: "branco" })]),
    async () => ({ alternatives: [{ foodName: "panco", confidence: 4, nutrition: { calories: 900 } }] }));
    expect(obs.normalizationPath.map(s => s.stage)).toEqual(["S1", "S2"]);
    expect(obs.interpreterVersion).toBeNull();
    expect(obs.identityHints.foodName).toBe("banco");
  });

  it("falha de leitura governada falha explicitamente, sem silenciosamente ignorar memória", async () => {
    const broken: LinguisticLexiconStore = { load: async () => { throw new Error("db-offline"); } };
    await expect(comprehendFoodLanguage(base, broken)).rejects.toThrow("db-offline");
  });

  it("não cria MealOperation ou decisão nutricional na observação", async () => {
    const [obs] = await analyze("2 ovos");
    expect("mealOperation" in obs).toBe(false);
    expect("nutrition" in obs).toBe(false);
    expect(obs.quantityHints.value).toBe(2);
  });

  it("limites são verificados antes de carregar léxico", async () => {
    const load = vi.fn(async () => []);
    await expect(comprehendFoodLanguage({ ...base, rawText: "  " }, { load })).rejects.toThrow("invalid-linguistic-input");
    await expect(comprehendFoodLanguage({ ...base, rawText: "x".repeat(20001) }, { load })).rejects.toThrow("invalid-linguistic-input");
    expect(load).not.toHaveBeenCalled();
  });
});
