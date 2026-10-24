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
// Known grammatical forms belong to the governed S2 test snapshot, not an
// implicit S1 food-name dictionary. Unrecognized surfaces remain unchanged.
const knownForms: GovernedLexiconEntry[] = [
  ["ovos", "ovo"], ["ovos cozidos", "ovo cozido"],
  ["ovos de codorna", "ovo de codorna"], ["bananas", "banana"],
  ["bananas prata", "banana prata"], ["maçãs fuji", "maçã fuji"],
].map(([term, targetRef], i) => entry({
  id: 1000 + i, term, normalizedTerm: term, targetRef,
}));
const analyze = (rawText: string, entries: GovernedLexiconEntry[] = knownForms, override: Partial<LinguisticRequest> = {}) =>
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

  it("A-021 não transforma porções vagas ou medidas desconhecidas em unidades exatas", async () => {
    const uncertain = [
      "um pouco de arroz", "um pouquinho de arroz", "um pedacinho de queijo",
      "uma pitada de sal", "2 pitadas de sal", "2 canecas de leite",
      "duas colheradas de arroz", "um gole de suco", "um punhado de amendoim",
    ];
    for (const rawText of uncertain) {
      const [item] = await analyze(rawText, []);
      expect(item.quantityHints).toMatchObject({
        value: null, unit: null, servingText: rawText,
      });
      expect(item.rawInput).toBe(rawText);
      expect(item.surfaceSpan.span).toEqual({ start: 0, end: rawText.length });
      expect(item.identityHints.foodName).toBeTruthy();
      expect(item.unresolvedReason).toBe("unknown_surface");
      expect(item.evidence.some(evidence => evidence.field === "quantity.value")).toBe(false);
    }
    const [unit] = await analyze("2 colheres de arroz", []);
    const [count] = await analyze("um ovo cozido", []);
    const [diminutiveFood] = await analyze("um bolinho", []);
    expect(unit.quantityHints).toMatchObject({ value: 2, unit: "colher" });
    expect(count.quantityHints).toMatchObject({ value: 1, unit: "un" });
    expect(diminutiveFood.quantityHints).toMatchObject({ value: 1, unit: "un" });
    const [governedMeasure] = await analyze("2 canecas de leite", [entry({
      id: 2104, kind: "unit_term", normalizedTerm: "canecas", targetRef: "copo",
    })]);
    expect(governedMeasure.quantityHints).toMatchObject({ value: 2, unit: "copo" });
    expect(governedMeasure.identityHints.foodName).toBe("leite");
    expect(governedMeasure.normalizationPath.map(step => step.stage)).toEqual(["S1", "S2"]);
  });

  it("A-022 preserva intervalos e escolhas sem inventar quantidade exata", async () => {
    const uncertain = [
      "2 a 3 ovos", "2 ou 3 ovos", "1 ou 2 bananas",
      "duas ou três fatias de pão", "2 até 3 copos de leite",
      "2-3 ovos", "entre 2 e 3 ovos", "entre duas e três bananas",
      "de 1,5 a 2 copos de leite",
    ];
    for (const rawText of uncertain) {
      const observations = await analyze(rawText, []);
      expect(observations).toHaveLength(1);
      const item = observations[0];
      expect(item.quantityHints).toMatchObject({ value: null, unit: null, servingText: rawText });
      expect(item.unresolvedReason).toBe("unknown_surface");
      expect(item.rawInput).toBe(rawText);
      expect(item.surfaceSpan.span).toEqual({ start: 0, end: rawText.length });
      expect(item.evidence.some(evidence => evidence.field === "quantity.value")).toBe(false);
    }
    const [certain] = await analyze("vinte e dois ovos", []);
    expect(certain.quantityHints).toMatchObject({ value: 22, unit: "un" });
    const distinct = await analyze("2 ovos e 3 bananas", []);
    expect(distinct).toHaveLength(2);
    expect(distinct[0].quantityHints.value).toBe(2);
    expect(distinct[1].quantityHints.value).toBe(3);
  });

  it("AUD1304 A-023 conserva a unidade colher no singular, plural e com meia", async () => {
    for (const [surface, amount, unit] of [
      ["uma colher de arroz", 1, "colher"],
      ["1 colher de arroz", 1, "colher"],
      ["2 colheres de arroz", 2, "colher"],
      ["uma colher e meia de arroz", 1.5, "colher"],
      ["1 colher e meia de arroz", 1.5, "colher"],
    ] as const) {
      const observations = await analyze(surface, []);
      expect(observations).toHaveLength(1);
      const [item] = observations;
      expect(item.quantityHints).toMatchObject({ value: amount, unit });
      expect(item.identityHints.foodName).toBe("arroz");
      expect(item.rawInput).toBe(surface);
      expect(item.surfaceSpan.span).toEqual({ start: 0, end: surface.length });
      expect(item.evidence.some(evidence => evidence.field === "quantity.value")).toBe(true);
    }
    const separate = await analyze("uma colher de arroz e uma banana", []);
    expect(separate).toHaveLength(2);
    expect(separate[0].quantityHints).toMatchObject({ value: 1, unit: "colher" });
    expect(separate[1].quantityHints).toMatchObject({ value: 1, unit: "un" });
    const [unknown] = await analyze("uma colherada de arroz", []);
    expect(unknown.quantityHints.value).toBeNull();
  });

  it("AUD1304 A-024 não converte intervalos com unidade contígua em contagem exata", async () => {
    for (const surface of [
      "30 a 40g de arroz", "30 a 40 g de arroz", "30-40g de arroz",
      "30–40g de arroz", "30 ou 40g de arroz", "de 30 a 40ml de leite",
      "entre 30 e 40g de arroz", "entre 30 e 40 g de arroz",
      "duas a três fatias de pão", "2 a 3kg de arroz",
    ]) {
      const observations = await analyze(surface, []);
      expect(observations).toHaveLength(1);
      const [item] = observations;
      expect(item.quantityHints).toMatchObject({ value: null, unit: null, servingText: surface });
      expect(item.rawInput).toBe(surface);
      expect(item.surfaceSpan.span).toEqual({ start: 0, end: surface.length });
      expect(item.unresolvedReason).toBe("unknown_surface");
      expect(item.evidence.some(evidence => evidence.field === "quantity.value")).toBe(false);
    }
    const [exact] = await analyze("40g de arroz", []);
    expect(exact.quantityHints).toMatchObject({ value: 40, unit: "g" });
    const distinct = await analyze("30g de arroz e 40g de feijão", []);
    expect(distinct).toHaveLength(2);
    expect(distinct.map(item => item.quantityHints.value)).toEqual([30, 40]);
  });

  it("AUD1304 A-025 não transforma recipientes sem unidade aprovada em alimento unitário", async () => {
    for (const surface of [
      "1 prato de arroz", "dois pratos de arroz", "2 marmitas de arroz",
      "1 marmita de arroz", "1 pote de iogurte", "uma garrafa de suco",
      "2 pacotes de arroz", "1 bandeja de frutas", "duas embalagens de biscoitos",
    ]) {
      const observations = await analyze(surface, []);
      expect(observations).toHaveLength(1);
      const [item] = observations;
      expect(item.quantityHints).toMatchObject({ value: null, unit: null, servingText: surface });
      expect(item.rawInput).toBe(surface);
      expect(item.surfaceSpan.span).toEqual({ start: 0, end: surface.length });
      expect(item.unresolvedReason).toBe("unknown_surface");
      expect(item.evidence.some(evidence => evidence.field === "quantity.value")).toBe(false);
    }
    const [governed] = await analyze("2 marmitas de arroz", [entry({
      id: 2405, kind: "unit_term", normalizedTerm: "marmitas", targetRef: "unidade",
    })]);
    expect(governed.quantityHints).toMatchObject({ value: 2, unit: "un" });
    expect(governed.identityHints.foodName).toBe("arroz");
    expect(governed.normalizationPath.map(step => step.stage)).toEqual(["S1", "S2"]);
    for (const surface of ["1 ovo de codorna", "2 ovos de codorna", "2 bolos de cenoura"]) {
      const [item] = await analyze(surface, []);
      expect(item.quantityHints).toMatchObject({ value: Number(surface[0]), unit: "un" });
    }
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

  it("transcrição incerta preserva o texto e oferece correções apenas como hipóteses", async () => {
    const text = "banco";
    const [observed] = await analyze(text, [entry({
      id: 92, term: "banco", normalizedTerm: "banco",
      kind: "typo", targetRef: "Panco",
    })], { modality: "audio_transcript" });
    expect(observed.modality).toBe("audio_transcript");
    expect(observed.rawInput).toBe(text);
    expect(observed.evidence[0].origin).toBe("transcription");
    expect(observed.identityHints.foodName).toBe("banco");
    expect(observed.alternatives[0].identityHints.foodName).toBe("panco");
  });

  it("payload de S3 inválido nunca autoriza outra identidade ou macros", async () => {
    const [obs] = await comprehendFoodLanguage({
      ...base, rawText: "banco", shouldInterpretResidual: () => true, interpreterVersion: "s3-v1",
    }, store([entry({ normalizedTerm: "banco", term: "banco", kind: "typo", targetRef: "branco" })]),
    async () => ({ alternatives: [{ foodName: "panco", confidence: 4, nutrition: { calories: 900 } }] }));
    expect(obs.normalizationPath.map(s => s.stage)).toEqual(["S1", "S2"]);
    expect(obs.interpreterVersion).toBeNull();
    expect(obs.identityHints.foodName).toBe("banco");
    expect(obs.unresolvedReason).toBe("provider_unavailable");
    expect(obs.evidence.some(e => e.origin === "unavailable" && e.value === null)).toBe(true);
  });

  it("falha de leitura governada falha explicitamente, sem silenciosamente ignorar memória", async () => {
    const broken: LinguisticLexiconStore = { load: async () => { throw new Error("db-offline"); } };
    await expect(comprehendFoodLanguage(base, broken)).rejects.toThrow("db-offline");
  });

  it("mantém a quantidade posterior à vírgula vinculada ao alimento e não funde dois alimentos", async () => {
    const [trailing] = await analyze("adicionar mortadela, uma fatia e meia");
    const [leading] = await analyze("adicionar 1,5 fatias de mortadela");
    const [numeric] = await analyze("adicionar mortadela, 1.5 fatias");
    for (const item of [trailing, leading, numeric]) {
      expect(item.identityHints.foodName).toBe("mortadela");
      expect(item.quantityHints).toMatchObject({ value: 1.5, unit: "fatia" });
      expect(item.rawInput.slice(item.surfaceSpan.span!.start, item.surfaceSpan.span!.end))
        .toContain("mortadela");
    }
    expect((await analyze("mortadela, duas bananas"))).toHaveLength(2);
    const [first, second] = await analyze("mortadela, duas bananas");
    expect(first.identityHints.foodName).toBe("mortadela");
    expect(second.identityHints.foodName).toBe("banana");
    expect(second.quantityHints.value).toBe(2);
  });

  it("converge flexões por léxico governado sem hardcode no runtime e preserva marcas protegidas", async () => {
    const [a] = await analyze("dois ovo cozido");
    const [b] = await analyze("2 ovos cozidos");
    expect(a.identityHints.foodName).toBe("ovo cozido");
    expect(b.identityHints.foodName).toBe(a.identityHints.foodName);
    expect(b.identityHints.qualifiers).toEqual(a.identityHints.qualifiers);
    const [governedExact] = await analyze("2 ovos cozidos", [
      entry({ id: 141, normalizedTerm: "ovos cozidos", term: "ovos cozidos",
        targetRef: "ovo cozido caipira" }),
    ]);
    expect(governedExact.normalizationPath[1].lexiconEntryId).toBe(141);
    expect(governedExact.identityHints.foodName).toBe("ovo cozido caipira");
    const [commercial] = await analyze("2 Doritos", [
      entry({ id: 90, normalizedTerm: "doritos", term: "Doritos",
        kind: "protected_token", targetType: "none", targetRef: null }),
    ]);
    expect(commercial.identityHints.foodName).toBe("doritos");
    const [unregisteredBrand] = await analyze("2 Doritos");
    expect(unregisteredBrand.identityHints.foodName).toBe("doritos");
    const [irregular] = await analyze("2 pães");
    expect(irregular.identityHints.foodName).toBe("paes");
  });

  it("S3 adiciona atributos semânticos com evidência por campo, sem tomar decisões", async () => {
    const [obs] = await comprehendFoodLanguage({
      ...base, rawText: "sanduíche", shouldInterpretResidual: () => true,
      interpreterVersion: "s3-v2",
    }, store(), async () => ({ alternatives: [{
      foodName: "sanduíche integral", confidence: 0.75, brand: "marca exemplo",
      variant: "integral", preparation: ["tostado"],
      qualifiers: [{
        value: "integral", attributeCode: null, role: "processing", confidence: 0.7,
      }],
    }] }));
    expect(obs.identityHints.foodName).toBe("sanduiche");
    expect(obs.alternatives[0].identityHints).toMatchObject({
      foodName: "sanduíche integral", brand: "marca exemplo", variant: "integral",
      preparation: ["tostado"], qualifiers: [{ value: "integral", role: "processing" }],
    });
    const fields = obs.alternatives[0].evidenceIds.map(id =>
      obs.evidence.find(evidence => evidence.evidenceId === id)?.field);
    expect(fields).toEqual([
      "identity.foodName", "identity.brand", "identity.variant",
      "identity.preparation", "identity.qualifiers",
    ]);
    expect(obs.evidence.filter(e => e.origin === "ai_estimate").every(e => !e.verified)).toBe(true);
    expect("nutrition" in obs).toBe(false);
  });

  it("S3 não pode inverter qualificador explícito nem contornar o schema estrito", async () => {
    const [obs] = await comprehendFoodLanguage({
      ...base, rawText: "café sem açúcar", shouldInterpretResidual: () => true,
      interpreterVersion: "s3-v2",
    }, store(), async () => ({ alternatives: [{
      foodName: "café com açúcar", confidence: 0.8,
      qualifiers: [{ value: "com açúcar", attributeCode: null,
        role: "sweetening", confidence: 0.8 }],
    }] }));
    expect(obs.unresolvedReason).toBe("provider_unavailable");
    expect(obs.identityHints.qualifiers[0].value).toBe("sem açúcar");
    expect(obs.alternatives).toHaveLength(0);
    expect(obs.evidence.some(e => e.origin === "unavailable")).toBe(true);
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
  it("AUD1304 A-004 conserva lactose explícita diante de alias conflitante", async () => {
    const [without] = await analyze("leite sem lactose", [entry({
      id: 600, normalizedTerm: "leite sem lactose", targetRef: "leite com lactose",
    })]);
    expect(without.identityHints.foodName).toBe("leite sem lactose");
    expect(without.identityHints.qualifiers).toContainEqual(expect.objectContaining({
      value: "sem lactose", role: "lactose",
    }));
    expect(without.alternatives).toHaveLength(1);
    const [withLactose] = await analyze("leite com lactose", [entry({
      id: 601, normalizedTerm: "leite com lactose", targetRef: "leite sem lactose",
    })]);
    expect(withLactose.identityHints.foodName).toBe("leite com lactose");
    expect(withLactose.alternatives).toHaveLength(1);
  });

  it("AUD1304 A-005 bloqueia contradição no foodName sem qualifiers estruturados", async () => {
    const payload = (foodName: string) => ({ alternatives: [{ foodName, confidence: 0.8 }] });
    const req = { ...base, rawText: "café sem açúcar", shouldInterpretResidual: () => true, interpreterVersion: "s3-v2" };
    const [bad] = await comprehendFoodLanguage(req, store(), async () => payload("café com açúcar"));
    expect(bad.identityHints.foodName).toBe("cafe sem acucar");
    expect(bad.alternatives).toHaveLength(0);
    expect(bad.unresolvedReason).toBe("provider_unavailable");
    const [good] = await comprehendFoodLanguage(req, store(), async () => payload("café sem açúcar"));
    expect(good.alternatives).toHaveLength(1);
  });

  it("AUD1304 A-006 plural governado converge sem reinterpretar marca capitalizada", async () => {
    const [plural] = await analyze("2 bananas");
    const [singular] = await analyze("duas banana");
    expect(plural.identityHints.foodName).toBe("banana");
    expect(singular.identityHints.foodName).toBe("banana");
    const [brand] = await analyze("2 Doritos pequenos");
    expect(brand.identityHints.foodName).toBe("doritos pequenos");
    const [unknownBrand] = await analyze("2 Doritos");
    expect(unknownBrand.identityHints.foodName).toBe("doritos");
    const [eggs] = await analyze("2 ovos cozidos");
    expect(eggs.identityHints.foodName).toBe("ovo cozido");
  });

  it("AUD1304 A-007 extrai destino operacional sem contaminar identidade", async () => {
    for (const rawText of [
      "Adicionar 2 ovos ao almoço",
      "2 ovos ao almoço",
      "No almoço comi 2 ovos",
      "Comi 2 ovos no almoço",
      "Registrar 2 ovos para o almoço",
    ]) {
      const [obs] = await analyze(rawText);
      expect(obs.identityHints.foodName).toBe("ovo");
      expect(obs.quantityHints).toMatchObject({ value: 2, unit: "un" });
      const span = obs.surfaceSpan.span!;
      expect(rawText.slice(span.start, span.end)).toBe("2 ovos");
      expect("mealOperation" in obs).toBe(false);
    }
  });


  it("AUD1304 A-008 isola refeição inicial sem verbo apenas com quantidade de alimento", async () => {
    for (const [rawText, expectedSurface] of [
      ["No almoço 2 ovos", "2 ovos"],
      ["no jantar dois ovos", "dois ovos"],
      ["No café da manhã 2 ovos", "2 ovos"],
      ["No almoço 2 ovos ao jantar", "2 ovos"],
    ]) {
      const [obs] = await analyze(rawText);
      expect(obs.identityHints.foodName).toBe("ovo");
      expect(obs.quantityHints).toMatchObject({ value: 2, unit: "un" });
      const span = obs.surfaceSpan.span!;
      expect(rawText.slice(span.start, span.end)).toBe(expectedSurface);
      expect(obs.rawInput).toBe(rawText);
      expect("mealOperation" in obs).toBe(false);
    }
    const [mass] = await analyze("No café da manhã 100g de queijo");
    expect(mass.quantityHints).toMatchObject({ value: 100, unit: "g" });
    expect(mass.identityHints.foodName).toBe("queijo");
    const [ambiguous] = await analyze("No almoço especial 2 ovos");
    expect(ambiguous.quantityHints.value).toBeNull();
    expect(ambiguous.identityHints.foodName).toBe("no almoco especial 2 ovos");
  });

  it("AUD1304 A-009 preserva marcas plurais sem diferença de caixa e sem alias", async () => {
    for (const rawText of ["2 Doritos", "2 doritos", "2 DORITOS", "dois doritos"]) {
      const [obs] = await analyze(rawText);
      expect(obs.identityHints.foodName).toBe("doritos");
      expect(obs.normalizedInput).toBe("doritos");
      expect(obs.quantityHints).toMatchObject({ value: 2, unit: "un" });
      expect(obs.unresolvedReason).toBe("unknown_surface");
      expect(obs.rawInput).toBe(rawText);
    }
    const [unconfirmedDiminutive] = await analyze("2 palitos");
    expect(unconfirmedDiminutive.identityHints.foodName).toBe("palitos");
    const [commonPlural] = await analyze("2 bananas");
    expect(commonPlural.identityHints.foodName).toBe("banana");
    const [agreedPlural] = await analyze("2 ovos cozidos");
    expect(agreedPlural.identityHints.foodName).toBe("ovo cozido");
  });

  it("AUD1304-NEW-001 reconhece unidades contíguas apenas com limite lexical seguro", async () => {
    for (const [spaced, compact, quantity, unit, food] of [
      ["100 g de queijo", "100g de queijo", 100, "g", "queijo"],
      ["250 ml de leite", "250ml de leite", 250, "ml", "leite"],
      ["1,5 kg de arroz", "1,5kg de arroz", 1.5, "kg", "arroz"],
    ] as const) {
      const [left] = await analyze(spaced);
      const [right] = await analyze(compact);
      expect(right.quantityHints).toMatchObject({ value: quantity, unit });
      expect(right.identityHints.foodName).toBe(food);
      expect({ value: left.quantityHints.value, unit: left.quantityHints.unit,
        food: left.identityHints.foodName }).toEqual({ value: right.quantityHints.value,
        unit: right.quantityHints.unit, food: right.identityHints.foodName });
      expect(right.rawInput).toBe(compact);
      expect(compact.slice(right.surfaceSpan.span!.start, right.surfaceSpan.span!.end)).toBe(compact);
    }
    for (const rawText of ["100guaraná", "2Panco", "1.000g de queijo", "1,500ml de leite"]) {
      const [observed] = await analyze(rawText);
      expect(observed.quantityHints.value).toBeNull();
      expect(observed.identityHints.foodName).toBe(rawText.normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").toLowerCase());
    }
  });

  it("AUD1304-NEW-002 segmenta 'e' entre alimentos sem apagar cardinalidade ou spans", async () => {
    for (const [joined, separated] of [
      ["2 ovos e banana", "2 ovos, banana"],
      ["arroz e feijão", "arroz, feijão"],
      ["2 ovos e 1 banana", "2 ovos, 1 banana"],
    ]) {
      const parts = await analyze(joined);
      const baseline = await analyze(separated);
      const projection = (observations: typeof parts) => observations.map(obs => ({
        food: obs.identityHints.foodName, value: obs.quantityHints.value, unit: obs.quantityHints.unit,
      }));
      expect(parts).toHaveLength(2);
      expect(projection(parts)).toEqual(projection(baseline));
      for (const part of parts) {
        const span = part.surfaceSpan.span!;
        expect(joined.slice(span.start, span.end)).toBeTruthy();
        expect(part.rawInput).toBe(joined);
      }
    }
    for (const rawText of ["uma fatia e meia de mortadela", "um e meio copo de leite"]) {
      expect(await analyze(rawText)).toHaveLength(1);
    }
  });

  it("AUD1304-NEW-003 aplica unit_term e portion_term no slot de unidade com prova S2", async () => {
    const global = entry({ id: 401, kind: "unit_term", term: "fts", normalizedTerm: "fts",
      targetRef: "fatia", confidence: 0.95 });
    const portion = entry({ id: 402, kind: "portion_term", term: "pçs", normalizedTerm: "pcs",
      targetRef: "porção" });
    const [alias] = await analyze("2 fts de pão", [global, portion]);
    const [canonical] = await analyze("2 fatias de pão");
    expect(alias.quantityHints).toMatchObject({ value: 2, unit: "fatia" });
    expect(alias.identityHints.foodName).toBe("pao");
    expect({ value: alias.quantityHints.value, unit: alias.quantityHints.unit,
      food: alias.identityHints.foodName }).toEqual({ value: canonical.quantityHints.value,
      unit: canonical.quantityHints.unit, food: canonical.identityHints.foodName });
    expect(alias.normalizationPath.map(step => [step.stage, step.lexiconEntryId]))
      .toContainEqual(["S2", 401]);
    expect(alias.evidence).toContainEqual(expect.objectContaining({
      field: "quantity.unit", origin: "catalog", value: "fts", unit: "fatia", verified: false,
    }));
    const [multiword] = await analyze("2 pçs de morango", [portion]);
    expect(multiword.quantityHints).toMatchObject({ value: 2, unit: "porção" });
    expect(multiword.identityHints.foodName).toBe("morango");
  });

  it("AUD1304-NEW-003 respeita escopo pessoal, revogação e colisões de unidade", async () => {
    const global = entry({ id: 501, kind: "unit_term", normalizedTerm: "fts", targetRef: "fatia" });
    const personal = entry({ id: 502, kind: "unit_term", normalizedTerm: "fts",
      scope: "user", userId: 5, status: "active", source: "user_confirmed", targetRef: "copo" });
    const [owner] = await analyze("2 fts de pão", [global, personal]);
    const [other] = await analyze("2 fts de pão", [global, personal], { ownerUserId: 7 });
    expect(owner.quantityHints.unit).toBe("copo");
    expect(owner.normalizationPath[1].lexiconEntryId).toBe(502);
    expect(other.quantityHints.unit).toBe("fatia");
    expect(other.normalizationPath[1].lexiconEntryId).toBe(501);
    const revoked = entry({ ...personal, id: 503, status: "revoked" });
    const [afterRevocation] = await analyze("2 fts de pão", [revoked]);
    expect(afterRevocation.quantityHints.unit).not.toBe("copo");
    expect(afterRevocation.normalizationPath.some(step => step.stage === "S2")).toBe(false);
    const [collision] = await analyze("2 fts de pão", [global, entry({
      id: 504, kind: "unit_term", normalizedTerm: "fts", targetRef: "copo",
    })]);
    expect(collision.quantityHints.value).toBeNull();
    expect(collision.quantityHints.unit).toBeNull();
    expect(collision.unresolvedReason).toBe("unknown_surface");
    expect(collision.alternatives.map(item => item.quantityHints.unit).sort())
      .toEqual(["copo", "fatia"]);
    const [unapproved] = await analyze("2 fts de pão", [entry({
      id: 505, kind: "unit_term", normalizedTerm: "fts", targetRef: "fatia",
      status: "pending_review",
    })]);
    expect(unapproved.quantityHints.unit).not.toBe("fatia");
  });

  it("AUD1304 A-010 converges governed plurals across case and preserves guarded brands", async () => {
    for (const [rawText, food] of [
      ["2 ovos cozidos", "ovo cozido"], ["2 OVOS COZIDOS", "ovo cozido"],
      ["2 Ovos Cozidos", "ovo cozido"],
      ["2 ovos de codorna", "ovo de codorna"],
      ["2 OVOS DE CODORNA", "ovo de codorna"],
      ["2 ovo de codorna", "ovo de codorna"],
      ["2 bananas", "banana"],
      ["2 Bananas", "banana"], ["2 BANANAS", "banana"],
      ["2 Doritos", "doritos"], ["2 DORITOS", "doritos"],
      ["2 Doritos pequenos", "doritos pequenos"],
      ["2 DORITOS PEQUENOS", "doritos pequenos"],
      ["2 doritos pequenos", "doritos pequenos"],
    ] as const) {
      const [obs] = await analyze(rawText);
      expect(obs.identityHints.foodName).toBe(food);
      expect(obs.quantityHints.value).toBe(2);
      expect(obs.rawInput).toBe(rawText);
      const span = obs.surfaceSpan.span!;
      expect(rawText.slice(span.start, span.end)).toBe(rawText);
    }
    const [protectedName] = await analyze("2 Havaianas", [
      entry({ id: 910, normalizedTerm: "havaianas", term: "Havaianas",
        kind: "protected_token", targetType: "none", targetRef: null }),
    ]);
    expect(protectedName.identityHints.foodName).toBe("havaianas");
  });

  it("AUD1304 A-011 prioritizes complete material qualifiers before standalone zero", async () => {
    for (const [text, qualifier, role] of [
      ["leite zero lactose", "zero lactose", "lactose"],
      ["leite sem lactose", "sem lactose", "lactose"],
      ["leite com lactose", "com lactose", "lactose"],
      ["produto zero glúten", "zero glúten", "gluten"],
      ["produto zero sal", "zero sal", "sodium"],
      ["produto zero gordura", "zero gordura", "fat_level"],
      ["café zero cafeína", "zero cafeína", "caffeine"],
      ["café zero açúcar", "zero açúcar", "sweetening"],
      ["leite UHT", "UHT", "processing"],
    ] as const) {
      const [obs] = await analyze(text);
      expect(obs.identityHints.qualifiers).toContainEqual(expect.objectContaining({ value: qualifier, role }));
      if (qualifier.startsWith("zero ")) {
        expect(obs.identityHints.qualifiers.some(q => q.value === "zero")).toBe(false);
      }
    }
    const [isolated] = await analyze("refrigerante Zero");
    expect(isolated.identityHints.qualifiers).toContainEqual(expect.objectContaining({
      value: "Zero", role: "sweetening",
    }));
    const [contradiction] = await analyze("leite zero lactose", [entry({
      id: 911, normalizedTerm: "leite zero lactose", targetRef: "leite com lactose",
    })]);
    expect(contradiction.identityHints.foodName).toBe("leite zero lactose");
    expect(contradiction.alternatives).toHaveLength(1);
  });

  it("AUD1304 A-012 adds evidence for S3 name-only qualifiers without duplicates", async () => {
    const request = { ...base, rawText: "pão", shouldInterpretResidual: () => true,
      interpreterVersion: "s3-v2" };
    const [implicit] = await comprehendFoodLanguage(request, store(), async () => ({
      alternatives: [{ foodName: "pão integral", confidence: 0.8 }],
    }));
    expect(implicit.identityHints.foodName).toBe("pao");
    expect(implicit.alternatives[0].identityHints.qualifiers).toContainEqual(
      expect.objectContaining({ value: "integral", role: "processing" }));
    const linked = implicit.alternatives[0].evidenceIds.map(id =>
      implicit.evidence.find(item => item.evidenceId === id));
    expect(linked.filter(item => item?.field === "identity.qualifiers")).toEqual([
      expect.objectContaining({
        value: "integral", origin: "ai_estimate", verified: false, confidence: 0.8,
      }),
    ]);
    const [deduplicated] = await comprehendFoodLanguage(request, store(), async () => ({
      alternatives: [{ foodName: "pão integral", confidence: 0.8, qualifiers: [{
        value: "integral", attributeCode: null, role: "processing", confidence: 0.7,
      }] }],
    }));
    expect(deduplicated.alternatives[0].identityHints.qualifiers).toHaveLength(1);
    expect(deduplicated.alternatives[0].evidenceIds.map(id =>
      deduplicated.evidence.find(item => item.evidenceId === id))
      .filter(item => item?.field === "identity.qualifiers")).toHaveLength(1);
    const [bad] = await comprehendFoodLanguage({ ...request, rawText: "leite zero lactose" },
      store(), async () => ({ alternatives: [{ foodName: "leite com lactose", confidence: 0.9 }] }));
    expect(bad.unresolvedReason).toBe("provider_unavailable");
    expect(bad.alternatives).toHaveLength(0);
  });



  it("AUD1304 A-013 conserva qualificadores ligados por 'e' sem criar alimento fantasma", async () => {
    for (const [text, roles] of [
      ["2 pães sem açúcar e sem glúten", ["sweetening", "gluten"]],
      ["iogurte zero lactose e sem açúcar", ["sweetening", "lactose"]],
      ["2 bolos fritos e cozidos", ["preparation", "preparation"]],
    ] as const) {
      const items = await analyze(text);
      expect(items).toHaveLength(1);
      const [obs] = items;
      expect(obs.identityHints.qualifiers.map(q => q.role).sort()).toEqual([...roles].sort());
      expect(obs.rawInput).toBe(text);
      const span = obs.surfaceSpan.span!;
      expect(text.slice(span.start, span.end)).toBe(text);
      expect(obs.evidence[0].anchor.span).toEqual(span);
    }
    // The same conjunction must still separate two identifiable foods.
    for (const text of ["2 pães sem açúcar e 1 banana", "2 ovos e banana", "arroz e feijão"]) {
      expect(await analyze(text)).toHaveLength(2);
    }
  });

  it("AUD1304 A-014 remove enquadramento separado por vírgula apenas com alimento inequívoco", async () => {
    for (const [text, expectedText, expectedAmount] of [
      ["No almoço, 2 ovos", "2 ovos", 2],
      ["No café da manhã, uma banana", "uma banana", 1],
      ["2 ovos, no almoço", "2 ovos", 2],
      ["2 ovos, para o jantar", "2 ovos", 2],
    ] as const) {
      const observations = await analyze(text);
      expect(observations).toHaveLength(1);
      const [obs] = observations;
      expect(obs.quantityHints.value).toBe(expectedAmount);
      expect(text.slice(obs.surfaceSpan.span!.start, obs.surfaceSpan.span!.end)).toBe(expectedText);
      expect(obs.rawInput).toBe(text);
      expect("mealOperation" in obs).toBe(false);
    }
    // Without a quantity-led food, uncertain surface must not vanish silently.
    const unclassified = await analyze("No almoço, queijo");
    expect(unclassified.map(item => item.identityHints.foodName)).toContain("no almoco");
    const twoFoods = await analyze("No almoço, 2 ovos e banana");
    expect(twoFoods.map(item => item.identityHints.foodName)).toEqual(["ovo", "banana"]);
  });

  it("AUD1304 A-015 converge plurais governados com modificador invariável, protegendo marca", async () => {
    for (const [plural, singular, expected] of [
      ["2 bananas prata", "2 banana prata", "banana prata"],
      ["2 maçãs fuji", "2 maçã fuji", "maca fuji"],
    ] as const) {
      const [a] = await analyze(plural);
      const [b] = await analyze(singular);
      expect(a.identityHints.foodName).toBe(expected);
      expect(a.identityHints.foodName).toBe(b.identityHints.foodName);
      expect(a.quantityHints).toMatchObject({ value: 2, unit: "un" });
      expect(plural.slice(a.surfaceSpan.span!.start, a.surfaceSpan.span!.end)).toBe(plural);
    }
    for (const [input, expected] of [
      ["2 Doritos pequenos", "doritos pequenos"],
      ["2 Pringles pequenas", "pringles pequenas"],
    ] as const) {
      const [obs] = await analyze(input);
      expect(obs.identityHints.foodName).toBe(expected);
    }
    const [governed] = await analyze("2 Havaianas prata", [entry({
      id: 915, normalizedTerm: "havaianas", kind: "protected_token",
      targetType: "none", targetRef: null,
    })]);
    expect(governed.identityHints.foodName).toBe("havaianas prata");
  });

  it("AUD1304 A-016 contabiliza meio alimento após o nome sem confundir outro item", async () => {
    for (const [text, amount, unit, food] of [
      ["dois ovos e meio", 2.5, "un", "ovo"],
      ["duas bananas e meia", 2.5, "un", "banana"],
      ["duas fatias de pão e meia", 2.5, "fatia", "pao"],
      ["uma fatia e meia de mortadela", 1.5, "fatia", "mortadela"],
    ] as const) {
      const observations = await analyze(text);
      expect(observations).toHaveLength(1);
      const [obs] = observations;
      expect(obs.quantityHints).toMatchObject({ value: amount, unit });
      expect(obs.identityHints.foodName).toBe(food);
      expect(text.slice(obs.surfaceSpan.span!.start, obs.surfaceSpan.span!.end)).toBe(text);
    }
    const [eggs, milk] = await analyze("2 ovos e meio copo de leite");
    expect(eggs.quantityHints).toMatchObject({ value: 2, unit: "un" });
    expect(eggs.identityHints.foodName).toBe("ovo");
    expect(milk.quantityHints).toMatchObject({ value: 0.5, unit: "copo" });
    expect(milk.identityHints.foodName).toBe("leite");
    expect(await analyze("2 ovos e 1 banana")).toHaveLength(2);
  });

  it("AUD1304 A-017 conserva meia unidade em listas com outro alimento", async () => {
    for (const [rawText, expectedUnit, expectedFood] of [
      ["duas fatias de pão e meia e uma banana", "fatia", "pao"],
      ["dois ovos e meio e uma banana", "un", "ovo"],
    ] as const) {
      const items = await analyze(rawText);
      expect(items).toHaveLength(2);
      expect(items[0].quantityHints).toMatchObject({ value: 2.5, unit: expectedUnit });
      expect(items[0].identityHints.foodName).toBe(expectedFood);
      expect(items[1].quantityHints).toMatchObject({ value: 1, unit: "un" });
      expect(items[1].identityHints.foodName).toBe("banana");
      for (const item of items) {
        const span = item.surfaceSpan.span!;
        expect(item.surfaceSpan.span).toEqual(item.evidence[0].anchor.span);
        expect(rawText.slice(span.start, span.end).trim().length).toBeGreaterThan(0);
        expect(item.rawInput).toBe(rawText);
      }
    }
    const [eggs, milk, banana] = await analyze("2 ovos e meio copo de leite e banana");
    expect([eggs.quantityHints.value, milk.quantityHints.value, banana.identityHints.foodName])
      .toEqual([2, 0.5, "banana"]);
    expect(await analyze("arroz e meia e banana")).toHaveLength(3);
  });

  it("AUD1304 A-018 converte dezenas escritas, frações e equivalentes sem inventar porções", async () => {
    for (const [written, numeric, amount, unit, food] of [
      ["vinte unidades de pão", "20 unidades de pão", 20, "un", "pao"],
      ["vinte e duas fatias de pão", "22 fatias de pão", 22, "fatia", "pao"],
      ["trinta e uma bananas", "31 bananas", 31, "un", "banana"],
      ["dezessete ovos", "17 ovos", 17, "un", "ovo"],
      ["1/2 copo de leite", "0,5 copo de leite", 0.5, "copo", "leite"],
      ["½ copo de leite", "0,5 copo de leite", 0.5, "copo", "leite"],
    ] as const) {
      const [left] = await analyze(written);
      const [right] = await analyze(numeric);
      expect(left.quantityHints).toMatchObject({ value: amount, unit });
      expect(left.identityHints.foodName).toBe(food);
      expect({ value: left.quantityHints.value, unit: left.quantityHints.unit,
        name: left.identityHints.foodName }).toEqual({ value: right.quantityHints.value,
        unit: right.quantityHints.unit, name: right.identityHints.foodName });
      expect(written.slice(left.surfaceSpan.span!.start, left.surfaceSpan.span!.end)).toBe(written);
    }
    for (const rawText of ["1/0 copo de leite", "12/10 copo de leite", "1.000 fatias de pão"]) {
      const [obs] = await analyze(rawText);
      expect(obs.quantityHints.value).toBeNull();
      expect(obs.rawInput).toBe(rawText);
    }
    const [first, second] = await analyze("vinte e duas fatias de pão e uma banana");
    expect(first.quantityHints).toMatchObject({ value: 22, unit: "fatia" });
    expect(second.identityHints.foodName).toBe("banana");
  });

  it("AUD1304 A-019 agrupa qualificadores pontuados sem gerar alimentos fantasma", async () => {
    for (const [surface, equivalent, name, roles] of [
      ["um café, sem açúcar", "um café sem açúcar", "cafe sem acucar", ["sweetening"]],
      ["2 ovos, cozidos", "2 ovos cozidos", "ovo cozido", ["preparation"]],
      ["um copo de leite, sem lactose", "um copo de leite sem lactose", "leite sem lactose", ["lactose"]],
      ["café, zero açúcar, sem lactose", "café zero açúcar sem lactose", "cafe zero acucar sem lactose", ["sweetening", "lactose"]],
      ["2 ovos, fritos", "2 ovos fritos", "ovos fritos", ["preparation"]],
      ["leite, UHT", "leite UHT", "leite uht", ["processing"]],
    ] as const) {
      const [punctuated] = await analyze(surface);
      const [plain] = await analyze(equivalent);
      expect(await analyze(surface)).toHaveLength(1);
      expect(punctuated.identityHints.foodName).toBe(name);
      expect(punctuated.identityHints.foodName).toBe(plain.identityHints.foodName);
      expect(punctuated.identityHints.qualifiers).toEqual(plain.identityHints.qualifiers);
      expect(roles.every(role => punctuated.identityHints.qualifiers.some(q => q.role === role))).toBe(true);
      expect(punctuated.quantityHints).toEqual(plain.quantityHints);
      const span = punctuated.surfaceSpan.span!;
      expect(surface.slice(span.start, span.end)).toBe(surface);
      expect(punctuated.evidence[0].anchor.span).toEqual(span);
      expect(punctuated.evidence[0].value).toContain(",");
      expect(punctuated.rawInput).toBe(surface);
    }
    const unicode = "🍳 2 ovos, cozidos e uma banana";
    const values = await analyze(unicode);
    expect(values).toHaveLength(2);
    expect(values.map(v => v.identityHints.foodName)).toEqual(["🍳 2 ovos cozidos", "banana"]);
    for (const item of values) {
      const span = item.surfaceSpan.span!;
      expect(unicode.slice(span.start, span.end)).toBeTruthy();
      expect(item.evidence[0].anchor.span).toEqual(span);
    }
    for (const surface of ["2 ovos, uma banana", "café, mel", "2 ovos; cozidos", "No almoço, sem açúcar"]) {
      expect(await analyze(surface)).toHaveLength(2);
    }
  });

  it("AUD1304 A-020 não singulariza identidade desconhecida por sufixo ou caixa", async () => {
    for (const input of [
      "2 Cheetos", "2 Cheetos pequenos", "2 cheetos", "2 CHEETOS",
      "2 Fandangos", "2 Fandangos crocantes", "2 fandangos", "2 FANDANGOS",
      "2 Havaianas", "2 Pringles", "2 Doritos", "2 bananas",
      "2 ovos", "2 ovos cozidos", "2 bananas prata", "2 ovos de codorna",
    ]) {
      const [item] = await analyze(input, []);
      const rawName = input.replace(/^2\s+/u, "");
      expect(item.identityHints.foodName).toBe(rawName.toLocaleLowerCase("pt-BR"));
      expect(item.normalizationPath.map(p => p.stage)).toEqual(["S1"]);
      expect(item.quantityHints).toMatchObject({ value: 2, unit: "un" });
      expect(item.rawInput.slice(item.surfaceSpan.span!.start, item.surfaceSpan.span!.end)).toBe(input);
    }
    const [governed] = await analyze("2 ovos cozidos");
    expect(governed.identityHints.foodName).toBe("ovo cozido");
    expect(governed.normalizationPath.map(p => p.stage)).toEqual(["S1", "S2"]);
    const [revoked] = await analyze("2 Fandangos", [entry({
      id: 1232, normalizedTerm: "fandangos", targetRef: "fandango", status: "revoked",
    })]);
    expect(revoked.identityHints.foodName).toBe("fandangos");
    const [unapproved] = await analyze("2 Cheetos", [entry({
      id: 1233, normalizedTerm: "cheetos", targetRef: "cheeto", status: "pending_review",
    })]);
    expect(unapproved.identityHints.foodName).toBe("cheetos");
  });

});
