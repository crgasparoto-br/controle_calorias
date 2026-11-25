import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { FOOD_CONTRACT_LIMITS } from "../contracts";
import { diagnoseFoodMaterialPendingIncrements, type GovernedLexiconEntry } from "../linguisticComprehension";
import { parseFoodMaterialObservationBatch, type FoodMaterialObservation } from "../schemas";
import { compareSealedMaterialProof, prepareMaterialProofInputs } from "./semanticConservation1341.material-proof.test.support";

const ref = {
  studyId: "b".repeat(32), parserSha: "c".repeat(40), comparatorSha: "d".repeat(40),
  adrSha256: "e".repeat(64), lockfileSha256: "f".repeat(64), lexiconRevision: "public-authored",
};
const runId = "a".repeat(32), profile = "r3-material-proof-v1";
const json = (x: unknown) => Buffer.from(JSON.stringify(x));
const digest = (x: Uint8Array) => createHash("sha256").update(x).digest("hex");
type Mode = "text" | "audio_transcript";
const lex = (term: string, id: number, extra: Partial<GovernedLexiconEntry> = {}): GovernedLexiconEntry => ({
  term, normalizedTerm: term, id, locale: "pt-BR", scope: "global", userId: null, source: null,
  status: "verified", current: true, validFrom: null, validTo: null, confidence: null, requiresClarification: false,
  kind: "alias_surface", targetType: "food_variant", targetRef: "public-author-" + id, ...extra,
});
const snapshot = [lex("bolo", 1), lex("anis", 2), lex("crepe", 3),
  lex("medidores", 4, { kind: "unit_term", targetType: "canonical_term", targetRef: "copo" }),
  lex("medidores", 5, { kind: "portion_term", targetType: "canonical_term", targetRef: "fatia" })];
const publicText = "🍐 2 fatias de pão com 3 g de canela; bolo sem anis; MAIS 4 fatias; mais um pouco; figos";
const conflictText = "2 medidores de crepe sem anis; 3 damascos";
const at = (raw: string, literal: string, from = 0) => {
  const start = raw.indexOf(literal, from);
  if (start < 0) throw new Error("authored reference text mismatch");
  return { start, end: start + literal.length };
};
const input = (n: number, text = publicText, modality: Mode = "text", semanticGroup = "9".repeat(32)) =>
  ({ id: String(n).repeat(32), text, modality, split: "holdout", semanticGroup });
type Input = ReturnType<typeof input>;

function authoredFacts(raw: string) {
  // Authored from the wording/roles and fixed synthetic S2 snapshot, before
  // invoking the producer. These are not reconstructed output expectations.
  return [
    { kind: "ingredient-measured", scope: at(raw, "🍐 2 fatias de pão com 3 g de canela"),
      owner: { name: at(raw, "pão"), nameHint: "pao", whole: { status: "exact", value: 2, unit: "fatia",
        measure: at(raw, "2 fatias"), serving: at(raw, "2 fatias de") } },
      ingredient: at(raw, "canela"), amount: { value: 3, unit: "g", measure: at(raw, "3 g") } },
    { kind: "negation-local", scope: at(raw, "bolo sem anis"),
      owner: { name: at(raw, "bolo"), nameHint: "bolo", lexical: { entryId: 1, variant: "public-author-1" },
        whole: { status: "absent" } },
      operator: at(raw, "sem"), ingredient: at(raw, "anis") },
    { kind: "pending-increment", scope: at(raw, "MAIS 4 fatias"), operator: at(raw, "MAIS"),
      amount: { value: 4, unit: "fatia", measure: at(raw, "4 fatias") } },
    { kind: "pending-continuation", scope: at(raw, "mais um pouco") },
    { kind: "independent-sibling", scope: at(raw, "figos"),
      owner: { name: at(raw, "figos"), nameHint: "figos", whole: { status: "absent" } } },
  ];
}

function conflictFacts(raw: string) {
  const wording = at(raw, "2 medidores");
  return [
    { kind: "negation-local", scope: at(raw, "2 medidores de crepe sem anis"),
      owner: { name: at(raw, "crepe"), nameHint: "crepe", lexical: { entryId: 3, variant: "public-author-3" }, whole: {
        status: "unit-conflict", serving: at(raw, "2"),
        hypotheses: [{ value: 2, unit: "copo", serving: wording }, { value: 2, unit: "fatia", serving: wording }],
      } }, operator: at(raw, "sem"), ingredient: at(raw, "anis") },
    { kind: "independent-sibling", scope: at(raw, "3 damascos"),
      owner: { name: at(raw, "damascos"), nameHint: "damascos", whole: {
        status: "exact", value: 3, unit: "un", measure: at(raw, "3"), serving: at(raw, "3"),
      } } },
  ];
}

function seal(entries: Input[], outputRows: unknown[], labels: unknown[] = entries.map(row =>
  ({ id: row.id, facts: authoredFacts(row.text) })), manifestChange: Record<string, unknown> = {},
  lexicalEntries = snapshot) {
  const lexiconSnapshot = json(lexicalEntries), inputs = json(entries), outputs = json(outputRows);
  const labelBytes = json({ nonce: "1".repeat(64), rows: labels });
  const manifest = json({ profile, schemaVersion: 1, ...ref, lexiconSha256: digest(lexiconSnapshot),
    inputsSha256: digest(inputs), labelsSha256: digest(labelBytes), caseCount: entries.length, ...manifestChange });
  const receipt = json({ profile, schemaVersion: 1, studyId: ref.studyId, runId, parserSha: ref.parserSha,
    manifestSha256: digest(manifest), outputsSha256: digest(outputs) });
  return { manifest, inputs, outputs, receipt, lexiconSnapshot, adrSha256: ref.adrSha256, lockfileSha256: ref.lockfileSha256,
    pinnedManifestSha256: digest(manifest), pinnedReceiptSha256: digest(receipt),
    parserCheckoutSha: ref.parserSha, comparatorCheckoutSha: ref.comparatorSha, expectedRunId: runId,
    readLabels: vi.fn(() => labelBytes) };
}

async function capture(entry: Input, lexiconEntries = snapshot) {
  return diagnoseFoodMaterialPendingIncrements({
    rawText: entry.text, modality: entry.modality, sourceRef: "c1b:" + entry.id,
    lexiconRevision: ref.lexiconRevision, ownerUserId: null, locale: "pt-BR", now: new Date("2026-11-25T00:00:00Z"),
  }, { load: async () => lexiconEntries });
}
async function mixed(entry = input(1)) {
  const r = await capture(entry);
  if (r.ok || r.reason !== "unproven-material") throw new Error("public control did not produce mixed batch");
  return r;
}

describe("sealed material proof, only public synthetic controls", () => {
  it("runs the label-blind API through the current opt-in producer in both modalities", async () => {
    const entries = [input(1), input(2, publicText, "audio_transcript")];
    const setup = seal(entries, []);
    const plan = prepareMaterialProofInputs(setup);
    expect(plan).toEqual({ lexiconRevision: ref.lexiconRevision, inputs: entries.map(x => ({
      id: x.id, rawText: x.text, modality: x.modality, sourceRef: "c1b:" + x.id,
    })) });
    expect(setup.readLabels).not.toHaveBeenCalled();
    const results = await Promise.all(plan.inputs.map(async ({ id, ...req }) => ({ id,
      result: await diagnoseFoodMaterialPendingIncrements({
        ...req, lexiconRevision: plan.lexiconRevision, locale: "pt-BR", ownerUserId: null, now: new Date("2026-11-25T00:00:00Z"),
      }, { load: async () => JSON.parse(setup.lexiconSnapshot.toString()) as GovernedLexiconEntry[] }) })));
    const packet = seal(entries, results.reverse());
    const report = compareSealedMaterialProof(packet);
    expect(report).toMatchObject({ authority: "diagnostic-only", profile,
      totals: { verified: 6, abstained: 4, missing: 0, mismatch: 0, duplicate: 0, extra: 0 } });
    expect(report.reasons["holdout/audio_transcript/pending-increment/typed-pending-anchored"]).toBe(1);
    expect(report.strata["holdout/text/pending-continuation"].abstained).toBe(1);
    expect(packet.readLabels).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(report)).not.toContain(publicText);
  });

  it("matches both independently authored surfaces after reversing relevant clause order", async () => {
    const reformulated = "figos; MAIS 4 fatias; bolo sem anis; mais um pouco; 🍐 2 fatias de pão com 3 g de canela";
    const entries = [input(1), input(2, reformulated)];
    const gold = entries.map(row => ({ id: row.id, facts: authoredFacts(row.text) }));
    const captureRows = await Promise.all(entries.map(async row => ({ id: row.id, result: await capture(row) })));
    expect(compareSealedMaterialProof(seal(entries, captureRows, gold)).totals)
      .toEqual({ verified: 6, abstained: 4, missing: 0, mismatch: 0, duplicate: 0, extra: 0 });
  });

  it("accepts separately labeled lexical uncertainty without crediting an exact main amount", async () => {
    const entry = input(1, conflictText);
    const gold = [{ id: entry.id, facts: conflictFacts(entry.text) }];
    const result = await capture(entry);
    if (!result.ok) throw new Error("public control must preserve even unresolved quantitative owner");
    const [owner] = result.observations;
    expect(owner.quantityHints.value).toBeNull();
    expect(owner.unresolvedReason).toBe("source_conflict");
    owner.alternatives.reverse();
    const good = seal([entry], [{ id: entry.id, result }], gold);
    expect(compareSealedMaterialProof(good).totals).toMatchObject({ verified: 2, mismatch: 0 });
    owner.alternatives = owner.alternatives.filter(x => x.quantityHints.unit !== "fatia");
    const missing = seal([entry], [{ id: entry.id, result }], gold);
    expect(compareSealedMaterialProof(missing).totals).toMatchObject({ verified: 1, mismatch: 1 });
    expect(missing.readLabels).toHaveBeenCalledTimes(1);
  });

  it.each(["transplant", "owner-anchor", "promote-pending", "swapped-parent", "strip", "other-profile"] as const)(
    "rejects repinned provenance, profile or partition error before label access: %s", async kind => {
      const entry = input(1);
      const result = await mixed(entry);
      const ret: Record<string, unknown> = result;
      const [typ] = result.affected;
      const child = typ.pendingObservation!;
      if (kind === "transplant") {
        // Same original text in another captured entry; leave raw/modality and
        // all same-case evidence untouched to exercise the transplanted ref.
        const other = await mixed(input(2, publicText, "audio_transcript"));
        const row = result.observations[0];
        const foreign = other.observations[0].surfaceSpan.sourceRef;
        row.surfaceSpan.sourceRef = foreign;
        for (const item of [...row.evidence, ...row.normalizationPath]) item.anchor.sourceRef = foreign;
      }
      if (kind === "owner-anchor") result.observations[0].normalizationPath[0].anchor = result.observations[1].surfaceSpan;
      if (kind === "promote-pending") {
        result.affected.shift();
        result.observations.push(child);
      }
      if (kind === "swapped-parent") typ.surfaceSpan = result.affected[1].surfaceSpan;
      if (kind === "strip") delete ret.diagnosticProfile;
      if (kind === "other-profile") ret.diagnosticProfile = "r3-pending-increment-v0";
      const packet = seal([entry], [{ id: entry.id, result }]);
      expect(() => compareSealedMaterialProof(packet)).toThrow({
        transplant: "source-provenance", "owner-anchor": "owner-provenance", "promote-pending": "ordinary-pending",
        "swapped-parent": "pending-parent", strip: "outputs-shape", "other-profile": "outputs-shape",
      }[kind]);
      expect(packet.readLabels).not.toHaveBeenCalled();
    });

  it("rejects crossed pending children instead of repairing the relation by ID", async () => {
    const entry = input(1, publicText + "; mais 3 kg");
    const result = await mixed(entry);
    const [left, right] = result.affected.filter(x => x.pendingObservation);
    [left.pendingObservation, right.pendingObservation] = [right.pendingObservation, left.pendingObservation];
    const packet = seal([entry], [{ id: entry.id, result }]);
    expect(() => compareSealedMaterialProof(packet)).toThrow("pending-parent");
    expect(packet.readLabels).not.toHaveBeenCalled();
  });

  it("rejects a repinned but inconsistent reference that labels a possible continued increment", async () => {
    const text = "mais 4 fatias\r\nde jaca; figos";
    const entry = input(1, text);
    const gold = [{ id: entry.id, facts: [{
      kind: "pending-increment", scope: at(text, "mais 4 fatias"), operator: at(text, "mais"),
      amount: { value: 4, unit: "fatia", measure: at(text, "4 fatias") },
    }] }];
    const result = await mixed(entry);
    const packet = seal([entry], [{ id: entry.id, result }], gold);
    expect(() => compareSealedMaterialProof(packet)).toThrow("label-operator");
    expect(packet.readLabels).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "duplicate", "extra"] as const)("distinguishes capture row %s before labels", async fault => {
    const entry = input(1), result = await mixed(entry);
    const row = { id: entry.id, result };
    const packet = seal([entry], fault === "missing" ? [] : fault === "duplicate" ? [row, row] : [row, { ...row, id: "2".repeat(32) }]);
    expect(() => compareSealedMaterialProof(packet)).toThrow("outputs-" + fault);
    expect(packet.readLabels).not.toHaveBeenCalled();
  });

  it("reports an invented attributed amount and an otherwise shape-valid downgrade after labels", async () => {
    const entry = input(1);
    const result = await mixed(entry);
    const [owner] = result.observations;
    owner.evidence.push({ ...owner.evidence[0], evidenceId: "extra-quantity",
      field: "quantity.grams", value: 7, unit: "g" });
    delete result.affected[0].pendingObservation;
    const packet = seal([entry], [{ id: entry.id, result }]);
    const report = compareSealedMaterialProof(packet);
    expect(report.totals).toMatchObject({ verified: 2, abstained: 1, missing: 1, mismatch: 1 });
    expect(report.reasons["holdout/text/pending-increment/pending-evidence-absent"]).toBe(1);
    expect(packet.readLabels).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "duplicate", "extra"] as const)("keeps semantic scope %s separate from capture rows", async fault => {
    const entry = input(1, fault === "extra" ? publicText + "; caquis" : publicText);
    const result = await mixed(entry);
    const sibling = result.observations.find(o => o.identityHints.foodName === "figos")!;
    if (fault === "missing") result.observations.splice(result.observations.indexOf(sibling), 1);
    if (fault === "duplicate") {
      const duplicate: FoodMaterialObservation = structuredClone(sibling);
      duplicate.observationId = "extra-distinct-observation-id";
      duplicate.evidence.forEach(e => { e.evidenceId += "-distinct"; });
      result.observations.push(duplicate);
    }
    const packet = seal([entry], [{ id: entry.id, result }]);
    const report = compareSealedMaterialProof(packet);
    for (const kind of ["missing", "duplicate", "extra"] as const) expect(report.totals[kind]).toBe(kind === fault ? 1 : 0);
    expect(packet.readLabels).toHaveBeenCalledTimes(1);
  });

  it.each([
    [" com ", " sem "], [" com ", ";    "], ["3 g de canela", "3 g do canela"],
  ])("rejects repinned positive ingredient labels with invalid literal boundary: %j → %j", async (old, replacement) => {
    expect(replacement.length).toBe(old.length);
    const original = input(1), result = await mixed(original);
    const gold = [{ id: original.id, facts: authoredFacts(original.text) }];
    const entry = { ...original, text: original.text.replace(old, replacement) };
    for (const row of result.observations) row.rawInput = entry.text;
    for (const item of result.affected) if (item.pendingObservation) item.pendingObservation.rawInput = entry.text;
    const packet = seal([entry], [{ id: entry.id, result }], gold);
    // Producer claim remains wire-valid and repinned, but gold is no longer a
    // plausible literal positive. It cannot return a passing score.
    expect(() => compareSealedMaterialProof(packet)).toThrow("label-ingredient-clause");
    expect(packet.readLabels).toHaveBeenCalledTimes(1);
  });

  it("refuses a labeled role variant absent from the pinned synthetic lexicon", async () => {
    const entry = input(1);
    const facts = authoredFacts(entry.text);
    const nominal = facts[1].owner!;
    nominal.lexical = { entryId: 1, variant: "not-a-pinned-variant" };
    const result = await mixed(entry);
    const packet = seal([entry], [{ id: entry.id, result }], [{ id: entry.id, facts }]);
    expect(() => compareSealedMaterialProof(packet)).toThrow("label-lexical-role");
    expect(packet.readLabels).toHaveBeenCalledTimes(1);
  });

  it("rejects a gold name that replaces rather than folds the raw owner", async () => {
    const entry = input(1), result = await mixed(entry);
    const facts = authoredFacts(entry.text);
    facts[0].owner!.nameHint = "guacamole";
    const packet = seal([entry], [{ id: entry.id, result }], [{ id: entry.id, facts }]);
    expect(() => compareSealedMaterialProof(packet)).toThrow("label-nominal-name");
    expect(packet.readLabels).toHaveBeenCalledTimes(1);
  });

  it("does not credit a nominal role if the pinned row is revoked", async () => {
    const entry = input(1), result = await mixed(entry);
    const restricted = snapshot.map(row => row.id === 1 ? { ...row, status: "revoked" as const } : row);
    const packet = seal([entry], [{ id: entry.id, result }], undefined, {}, restricted);
    expect(() => compareSealedMaterialProof(packet)).toThrow("label-lexical-role");
    expect(packet.readLabels).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["brand", "pao"], ["qualifier", "pao"], ["catalog", "pao"],
    ["alternative", "pao"], ["normalized", "pao"], ["interpreter", "pao"],
    ["catalog", "bolo"], ["alternative", "bolo"], ["normalized", "bolo"],
    ["preparation", "figos"], ["barcode", "figos"], ["primary-variant", "figos"],
    ["interpreter", "figos"],
  ] as const)("reports repinned %s claim on nominal owner %s as a semantic mismatch", async (fault, food) => {
    const entry = input(1), result = await mixed(entry);
    const item = result.observations.find(o => o.identityHints.foodName === food)!;
    if (fault === "brand") item.identityHints.brand = "Marca inventada";
    if (fault === "qualifier") {
      item.identityHints.qualifiers.push({ value: "zero lactose", role: "lactose", attributeCode: null, confidence: null });
      item.evidence.push({ ...item.evidence[0], evidenceId: "invented-qualifier", field: "identity.qualifiers", value: "zero lactose" });
    }
    if (fault === "catalog") {
      const echo = item.evidence.find(e => e.origin === "catalog");
      if (echo) echo.value = "guacamole";
      else item.evidence.push({ ...item.evidence[0], evidenceId: "invented-catalog-name",
        field: "identity.foodName", origin: "catalog", value: "guacamole" });
    }
    if (fault === "alternative") item.alternatives.push({ hypothesisId: "invented-name",
      identityHints: { ...item.identityHints, foodName: "guacamole" }, quantityHints: { ...item.quantityHints },
      evidenceIds: [], confidence: null });
    if (fault === "normalized") item.normalizedInput = "guacamole";
    if (fault === "interpreter") {
      item.interpreterVersion = "synthetic-interpreter";
      item.normalizationPath.push({ stage: "S3", origin: "interpreter",
        lexiconEntryId: null, anchor: item.surfaceSpan, confidence: 0.91 });
    }
    if (fault === "preparation") item.identityHints.preparation = ["assados"];
    if (fault === "barcode") item.identityHints.barcode = "0123456789012";
    if (fault === "primary-variant") item.identityHints.variant = "unobserved-variant";
    const packet = seal([entry], [{ id: entry.id, result }]);
    const report = compareSealedMaterialProof(packet);
    expect(report.totals).toEqual({ verified: 2, abstained: 2, mismatch: 1, missing: 0, duplicate: 0, extra: 0 });
    expect(packet.readLabels).toHaveBeenCalledTimes(1);
  });

  it("keeps the pinned same-name S2 variant but rejects a different identity in a valid unit hypothesis", async () => {
    const entry = input(1, conflictText), gold = [{ id: entry.id, facts: conflictFacts(entry.text) }];
    const result = await capture(entry);
    if (!result.ok) throw new Error("expected ordinary conflict");
    const owner = result.observations[0];
    const variant = owner.alternatives.find(x => x.identityHints.variant === "public-author-3");
    if (!variant) throw new Error("expected separately labeled same-name S2 role");
    const good = seal([entry], [{ id: entry.id, result }], gold);
    expect(compareSealedMaterialProof(good).totals).toMatchObject({ verified: 2, mismatch: 0 });
    owner.alternatives.find(x => x.quantityHints.value !== null)!.identityHints.foodName = "guacamole";
    const repinned = seal([entry], [{ id: entry.id, result }], gold);
    expect(compareSealedMaterialProof(repinned).totals).toMatchObject({ verified: 1, mismatch: 1 });
    expect(repinned.readLabels).toHaveBeenCalledTimes(1);
  });

  it("does not allow an aligned subtoken of the nominal owner to receive credit", async () => {
    const entry = input(1), result = await mixed(entry);
    const facts = authoredFacts(entry.text), expected = facts[0].owner!;
    expected.name = { ...expected.name, start: expected.name.start + 1 };
    expected.nameHint = "ao";
    const actual = result.observations[0];
    actual.identityHints.foodName = actual.normalizedInput = "ao";
    const name = actual.evidence.find(e => e.field === "identity.foodName")!;
    name.anchor.span = expected.name;
    name.value = "ão";
    const packet = seal([entry], [{ id: entry.id, result }], [{ id: entry.id, facts }]);
    expect(() => compareSealedMaterialProof(packet)).toThrow("label-nominal-boundary");
    expect(packet.readLabels).toHaveBeenCalledTimes(1);
  });

  it("credits the complete multiword owner, not an independently aligned suffix word", async () => {
    const raw = "2 copos de caldo de sopa com 3 g de alho";
    const entry = input(1, raw);
    const result = await capture(entry);
    if (!result.ok) throw new Error("independent control needs a measured compound name");
    const gold = { kind: "ingredient-measured", scope: at(raw, raw),
      owner: { name: at(raw, "caldo de sopa"), nameHint: "caldo de sopa",
        whole: { status: "exact", measure: at(raw, "2 copos"), serving: at(raw, "2 copos de"), value: 2, unit: "copo" } },
      ingredient: at(raw, "alho"), amount: { measure: at(raw, "3 g"), value: 3, unit: "g" },
    };
    const labels = [{ id: entry.id, facts: [gold] }];
    expect(compareSealedMaterialProof(seal([entry], [{ id: entry.id, result }], labels)).totals.verified).toBe(1);
    const row = result.observations[0], name = row.evidence.find(e => e.field === "identity.foodName")!;
    for (const attempted of ["sopa", "caldo"]) {
      gold.owner.name = at(raw, attempted);
      gold.owner.nameHint = row.identityHints.foodName = row.normalizedInput = name.value = attempted;
      name.anchor.span = gold.owner.name;
      const packet = seal([entry], [{ id: entry.id, result }], labels);
      expect(() => compareSealedMaterialProof(packet)).toThrow("label-");
      expect(packet.readLabels).toHaveBeenCalledTimes(1);
    }
  });

  it("does not let a hard-bounded sibling claim skip quotes or a lexical prefix", async () => {
    for (const raw of ["«sopa»", "caldo de sopa"]) {
      const entry = input(1, raw), result = await capture(entry);
      if (!result.ok) throw new Error("expected ordinary sibling control");
      const row = result.observations[0];
      row.surfaceSpan.span = at(raw, "sopa");
      const name = row.evidence.find(e => e.field === "identity.foodName")!;
      name.anchor.span = row.surfaceSpan.span;
      name.value = row.identityHints.foodName = row.normalizedInput = "sopa";
      row.normalizationPath = [];
      const labels = [{ id: entry.id, facts: [{
        kind: "independent-sibling", scope: at(raw, "sopa"),
        owner: { name: at(raw, "sopa"), nameHint: "sopa", whole: { status: "absent" } },
      }] }];
      const packet = seal([entry], [{ id: entry.id, result }], labels);
      expect(() => compareSealedMaterialProof(packet)).toThrow("label-nominal-boundary");
      expect(packet.readLabels).toHaveBeenCalledTimes(1);
    }
  });

  it.each(["different-kind", "same-target", "target-role"] as const)(
    "rejects all compatible active S2 competitors independently of order: %s", async kind => {
      const entry = input(1), captured = await mixed(entry);
      const competitor = kind === "same-target" ? lex("bôlo", 12, { targetRef: "public-author-1" }) :
        lex(kind === "target-role" ? "anis" : "bôlo", 12,
          { kind: "slang", targetType: "canonical_term", targetRef: "public-independent-term" });
      const universe = [...snapshot, competitor];
      for (const order of [universe, [...universe].reverse()]) {
        const real = await capture(entry, order);
        expect("observations" in real && real.observations.some(row =>
          row.materialClaims.some(claim => claim.kind === "negation"))).toBe(false);
        const packet = seal([entry], [{ id: entry.id, result: captured }], undefined, {}, order);
        expect(() => compareSealedMaterialProof(packet)).toThrow("label-lexical-role");
        expect(packet.readLabels).toHaveBeenCalledTimes(1);
      }
    });

  it("ignores inapplicable competing rows, but does not guess time for an otherwise compatible dated row", async () => {
    const entry = input(1), captured = await mixed(entry);
    const optional = lex("bolo", 12, { kind: "slang", targetType: "canonical_term", targetRef: "out-of-scope-role" });
    const inert = [{ ...optional, status: "revoked" as const }, { ...optional, locale: "pt-PT", id: 13 }];
    const allowed = seal([entry], [{ id: entry.id, result: captured }], undefined, {}, [...snapshot, ...inert]);
    expect(compareSealedMaterialProof(allowed).totals.verified).toBe(3);
    const uncertain = seal([entry], [{ id: entry.id, result: captured }], undefined, {},
      [...snapshot, { ...optional, validTo: new Date("2026-12-01T00:00:00Z") }]);
    expect(() => compareSealedMaterialProof(uncertain)).toThrow("label-lexical-role");
  });

  it("requires the pinned literal unit group, not a self-consistent but invented conflict", async () => {
    const entry = input(1, conflictText), gold = [{ id: entry.id, facts: conflictFacts(entry.text) }];
    const captured = await capture(entry);
    const reduced = snapshot.filter(x => x.id !== 5);
    const real = await capture(entry, reduced);
    if (!("observations" in real)) throw new Error("expected control with resolved unit");
    expect(real.observations[0].quantityHints).toMatchObject({ value: 2, unit: "copo" });
    for (const supplied of [reduced, [...reduced].reverse(),
      [...snapshot, lex("medidores", 14, { kind: "portion_term", targetType: "canonical_term", targetRef: "colher" })]]) {
      const forged = seal([entry], [{ id: entry.id, result: captured }], gold, {}, supplied);
      expect(() => compareSealedMaterialProof(forged)).toThrow("label-unit-conflict");
      expect(forged.readLabels).toHaveBeenCalledTimes(1);
    }
    const revoked = [...snapshot, lex("medidores", 14, {
      kind: "portion_term", targetType: "canonical_term", targetRef: "colher", status: "revoked",
    })].reverse();
    expect(compareSealedMaterialProof(seal([entry], [{ id: entry.id, result: captured }], gold, {}, revoked)).totals.verified).toBe(2);
  });

  it.each([
    ["3 g de canela", "-3g de canela"], ["3 g de canela", "4 g de canela"],
    ["3 g de canela", "3 l de canela"], ["2 fatias de pão", "9 fatias de pão"],
    ["MAIS 4 fatias", "MAIS 9 fatias"],
  ])("rejects a repinned exact quantity that differs from the literal witness: %j", async (from, to) => {
    expect(from.length).toBe(to.length);
    const original = input(1), result = await mixed(original);
    const facts = authoredFacts(original.text);
    const entry = { ...original, text: original.text.replace(from, to) };
    for (const row of result.observations) row.rawInput = entry.text;
    for (const item of result.affected) if (item.pendingObservation) item.pendingObservation.rawInput = entry.text;
    const packet = seal([entry], [{ id: entry.id, result }], [{ id: entry.id, facts }]);
    expect(() => compareSealedMaterialProof(packet)).toThrow("label-exact-amount");
    expect(packet.readLabels).toHaveBeenCalledTimes(1);
  });

  it("recognizes explicitly witnessed decimal and fractional amounts without interpreting a range", async () => {
    const raw = "MAIS ½ copo; 1,25 g de damascos";
    const entry = input(1, raw);
    const gold = [{ id: entry.id, facts: [
      { kind: "pending-increment", scope: at(raw, "MAIS ½ copo"), operator: at(raw, "MAIS"),
        amount: { value: .5, unit: "copo", measure: at(raw, "½ copo") } },
      { kind: "independent-sibling", scope: at(raw, "1,25 g de damascos"),
        owner: { name: at(raw, "damascos"), nameHint: "damascos", whole: {
          status: "exact", measure: at(raw, "1,25 g"), serving: at(raw, "1,25 g de"), value: 1.25, unit: "g",
        } } },
    ] }];
    const live = await capture(entry);
    expect(compareSealedMaterialProof(seal([entry], [{ id: entry.id, result: live }], gold)).totals)
      .toEqual({ verified: 1, abstained: 1, mismatch: 0, missing: 0, duplicate: 0, extra: 0 });
  });

  it.each([
    ["ingredient", "alho ou sal"], ["ingredient", "???"], ["ingredient", "alho, 1 pera"],
    ["ingredient", "alho e sal"], ["ingredient", "alho sal"], ["ingredient", "alho de dois"],
    ["ingredient", "alho de sal de cozinha"], ["ingredient", "alho-poró"], ["ingredient", "alho2"],
    ["negation", "anis ou alho"], ["negation", "anis do campo"], ["negation", "anis!"],
  ] as const)("refuses a repinned %s target outside the nominal profile: %j", async (kind, target) => {
    const originalTail = kind === "ingredient" ? "alho" : "anis";
    const prefix = kind === "ingredient" ? "sopa com 4 g de " : "bolo sem ";
    const original = input(1, prefix + originalTail);
    const captured = await capture(original);
    if (!captured.ok) throw new Error("expected known positive source");
    const entry = { ...original, text: prefix + target };
    const row = captured.observations[0], [claim] = row.materialClaims;
    if (claim.kind !== "ingredient" && claim.kind !== "negation") throw new Error("expected ingredient-role claim");
    const evidence = row.evidence.find(e => e.evidenceId === claim.ingredient.evidenceId)!;
    row.rawInput = entry.text;
    for (const anchor of [row.surfaceSpan, ...row.evidence.map(e => e.anchor), ...row.normalizationPath.map(s => s.anchor)]) {
      if (anchor.span?.end === original.text.length) anchor.span = { ...anchor.span, end: entry.text.length };
    }
    claim.ingredient.name = evidence.value = target;
    expect(parseFoodMaterialObservationBatch(captured.observations).ok).toBe(true);

    const scope = at(entry.text, entry.text), ingredient = at(entry.text, target, prefix.length);
    const gold = kind === "ingredient" ? {
      kind: "ingredient-measured", scope, ingredient,
      owner: { name: at(entry.text, "sopa"), nameHint: "sopa", whole: { status: "absent" } },
      amount: { value: 4, unit: "g", measure: at(entry.text, "4 g") },
    } : {
      kind: "negation-local", scope, ingredient, operator: at(entry.text, "sem"),
      owner: { name: at(entry.text, "bolo"), nameHint: "bolo", whole: { status: "absent" },
        lexical: { entryId: 1, variant: "public-author-1" } },
    };
    // A new nominal alias cannot make the wrong clause structure legitimate.
    const supplied = kind === "ingredient" ? snapshot : [...snapshot, lex(target, 90)];
    const packet = seal([entry], [{ id: entry.id, result: captured }], [{ id: entry.id, facts: [gold] }], {}, supplied);
    expect(() => compareSealedMaterialProof(packet)).toThrow("label-target-nominal");
    expect(packet.readLabels).toHaveBeenCalledTimes(1);
  });

  it.each(["text", "audio_transcript"] as const)(
    "preserves an explicit multiword nominal link and a separate single-target negation in %s", async mode => {
      const raw = "sopa com 4 g de pimenta do reino; bolo sem anis";
      const entry = input(1, raw, mode);
      const labels = [{ id: entry.id, facts: [
        { kind: "ingredient-measured", scope: at(raw, "sopa com 4 g de pimenta do reino"),
          owner: { name: at(raw, "sopa"), nameHint: "sopa", whole: { status: "absent" } },
          ingredient: at(raw, "pimenta do reino"), amount: { value: 4, unit: "g", measure: at(raw, "4 g") } },
        { kind: "negation-local", scope: at(raw, "bolo sem anis"),
          owner: { name: at(raw, "bolo"), nameHint: "bolo", whole: { status: "absent" },
            lexical: { entryId: 1, variant: "public-author-1" } }, operator: at(raw, "sem"), ingredient: at(raw, "anis") },
      ] }];
      const live = await capture(entry);
      const packet = seal([entry], [{ id: entry.id, result: live }], labels);
      expect(compareSealedMaterialProof(packet).totals).toEqual({
        verified: 2, abstained: 0, mismatch: 0, missing: 0, duplicate: 0, extra: 0,
      });
    });

  it("does not double-count a typed pending child, but rejects the aggregate +1 before labels", async () => {
    const entry = input(1);
    const result = await mixed(entry);
    const plain = result.affected[1];
    for (let i = result.affected.length + result.observations.length; i < FOOD_CONTRACT_LIMITS.observations; i++) {
      result.affected.push({ ...plain, observationId: "public-extra-" + i });
    }
    const full = seal([entry], [{ id: entry.id, result }]);
    expect(compareSealedMaterialProof(full).totals.duplicate).toBe(FOOD_CONTRACT_LIMITS.observations - 5);
    result.affected.push({ ...plain, observationId: "public-over-budget" });
    const packet = seal([entry], [{ id: entry.id, result }]);
    expect(() => compareSealedMaterialProof(packet)).toThrow("occurrence-budget");
    expect(packet.readLabels).not.toHaveBeenCalled();
  });
});
