import { afterEach, describe, expect, it, vi } from "vitest";
import { createFoodD1PublicWhatsAppVisualRegistration,
  fromTrustedD1WhatsAppMediaDataUrl,
  isAnyD1WhatsAppVisualEntrypointSelected } from "./publicWhatsAppVisualRegistration";
import type { PublicD1WhatsAppVisualDependencies } from "./publicWhatsAppVisualRegistration";
import { buildFoodObservationFixture, buildFoodResolutionDecisionFixture } from "./fixtures";
import { parseD1WhatsAppVisualIntent } from "../whatsapp/mealCommandParser";

const sha = "c".repeat(40);
const context = {
  expectedAuditedBaseSha: sha,
  approval: { status: "approved" as const, auditedBaseSha: sha,
    gateAReference: "gate-a-approved-fixture", rolloutReference: "rollout-approved-fixture" },
  revisions: { code: sha, knowledge: "k1", lexicon: "l1", policy: "p1", resolver: "r1" },
};
const input = () => ({
  userId: 7, externalMessageId: "wamid.visual-001",
  image: { base64: "aW1hZ2U=", mimeType: "image/jpeg" },
  intent: parseD1WhatsAppVisualIntent("#prato @almoco"),
  receivedAt: new Date("2026-11-04T15:00:00.000Z"),
  timeZone: "America/Sao_Paulo",
});
const prior = {
  committed: true, replayed: false, mealId: 44,
  operationKey: "d1-whatsapp-visual-001",
  recordedItemIds: [17], skipped: [],
};
function service(overrides: Partial<PublicD1WhatsAppVisualDependencies> = {}) {
  const deps = {
    readContextSources: async () => ({
      previousMessage: { status: "unavailable" as const, reason: "fixture_no_message", sourceRef: null },
      preferences: { status: "absent" as const, reason: "fixture_no_preferences", sourceRef: null },
      recentHistory: { status: "absent" as const, reason: "fixture_no_history", sourceRef: null },
    }),
    readAuthorizedContext: vi.fn(async () => context),
    readActivePending: vi.fn(async () => false),
    extract: vi.fn(async () => ({
      surfaces: ["100 g de arroz"], contentDigest: "a".repeat(64),
    })),
    comprehend: vi.fn(async (req: { rawText: string; sourceRef: string;
      modality: "image" | "text" | "audio_transcript" }) => [
      buildFoodObservationFixture({
        modality: req.modality,
        rawInput: req.rawText,
        normalizedInput: req.rawText,
        identityHints: { foodName: "arroz" },
        surfaceSpan: { sourceRef: req.sourceRef },
        lexiconRevision: "l1",
      }),
    ]),
    lexicon: { load: vi.fn(async () => []) },
    knowledge: { readLocal: vi.fn(async () => ({ kind: "miss" as const, reason: "not_found" as const })),
      readPendingEvidence: vi.fn(async () => null), stagePendingEvidence: vi.fn(async () => {}) },
    run: vi.fn(async (args: {
      request: { entrypoint: string; envelope: { idempotencyKey: string;
        ownerUserId: number }; evidence: { observations: unknown[] } };
      beforeCommit?: (plan: unknown) => void; legacy: () => Promise<unknown>;
    }) => {
      await expect(args.legacy()).rejects.toThrow("food-d1-whatsapp-visual-cannot-replay-v1");
      args.beforeCommit?.({
        items: [{ disposition: "ready" }], readyCount: 1,
      });
      return { ...prior, operationKey: args.request.envelope.idempotencyKey };
    }),
    renderCommittedMeal: vi.fn(async () => "Arroz confirmado: 130 kcal"),
    ...overrides,
  };
  return { deps, run: createFoodD1PublicWhatsAppVisualRegistration(
    deps as unknown as PublicD1WhatsAppVisualDependencies,
  ) };
}
afterEach(() => vi.unstubAllEnvs());
describe("#1308 WhatsApp image -> canonical V2", () => {
  it("derives MIME from trusted normalized data URL and rejects non-image resources", () => {
    expect(fromTrustedD1WhatsAppMediaDataUrl("data:image/jpeg;base64,/9j/4A=="))
      .toMatchObject({ mimeType: "image/jpeg", base64: "/9j/4A==" });
    for (const url of ["https://example.invalid/photo", "data:text/html;base64,YWJj",
      "data:image/png;base64,#", "data:image/svg+xml;base64,YWJj"]) {
      expect(() => fromTrustedD1WhatsAppMediaDataUrl(url))
        .toThrow("food-d1-whatsapp-visual-normalized-media-required");
    }
  });
  it("never requests image decoding for the V1 path with the global flag OFF", () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "false");
    expect(isAnyD1WhatsAppVisualEntrypointSelected()).toBe(false);
    vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "text");
    expect(isAnyD1WhatsAppVisualEntrypointSelected()).toBe(false);
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "plate_image");
    expect(isAnyD1WhatsAppVisualEntrypointSelected()).toBe(true);
  });
  it("does not call gate or provider when V2 flag is OFF", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "false");
    const { deps, run } = service();
    expect(await run(input())).toBeNull();
    expect(deps.readAuthorizedContext).not.toHaveBeenCalled();
    expect(deps.extract).not.toHaveBeenCalled();
  });
  it.each(["plate_image", "packaging"] as const)(
    "binds original WhatsApp message, %s image digest and trusted origin to a single V2 writer",
    async kind => {
      vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
      vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", kind);
      const { deps, run } = service();
      const result = await run({ ...input(),
        intent: parseD1WhatsAppVisualIntent(
          kind === "plate_image" ? "#prato @almoco" : "#embalagem @almoco",
        ),
      });
      expect(result?.data?.mealId).toBe(44);
      expect(deps.run).toHaveBeenCalledOnce();
      const request = vi.mocked(deps.run).mock.calls[0][0].request;
      expect(request.envelope.ownerUserId).toBe(7);
      expect(request.entrypoint).toBe(kind);
      expect(request.evidence.observations).toHaveLength(1);
      expect(request.envelope.idempotencyKey).toMatch(/^d1-whatsapp-/);
      expect(deps.renderCommittedMeal).toHaveBeenCalledOnce();
    },
  );
  it("gate failure stops before DB, provider and parser", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "plate_image");
    const { deps, run } = service({ readAuthorizedContext: async () => null });
    await expect(run(input())).rejects.toThrow("food-d1-whatsapp-visual-gate-unavailable");
    expect(deps.extract).not.toHaveBeenCalled();
    expect(deps.readActivePending).not.toHaveBeenCalled();
  });
  it("refuses a missing explicit role without calling model, even with a selected flag", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "plate_image");
    const { deps, run } = service();
    await expect(run({ ...input(), intent: null }))
      .rejects.toThrow("food-d1-whatsapp-visual-explicit-role-required");
    expect(deps.extract).not.toHaveBeenCalled();
  });
  it("blocks legacy active pending and never writes a new V2 meal", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "plate_image");
    const { deps, run } = service({ readActivePending: async () => true });
    await expect(run(input())).rejects.toThrow("food-d1-whatsapp-visual-legacy-pending-active");
    expect(deps.extract).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
  });
  it("rejects incomplete sibling batches without committing a partially inferred meal", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "plate_image");
    const { deps, run } = service({
      run: vi.fn(async (args: Parameters<PublicD1WhatsAppVisualDependencies["run"]>[0]) => {
        args.beforeCommit?.({ items: [{ disposition: "deferred" }], readyCount: 0 } as never);
        throw new Error("unexpected-commit");
      }) as PublicD1WhatsAppVisualDependencies["run"],
    });
    await expect(run(input())).rejects.toThrow("food-d1-whatsapp-visual-needs-clarification");
    expect(deps.renderCommittedMeal).not.toHaveBeenCalled();
  });
  it("does not stage pending for an ordinary Error that only copies the clarification message", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "plate_image");
    const unrelated = new Error("food-d1-whatsapp-visual-needs-clarification");
    const stagePending = vi.fn(async () => undefined);
    const { deps, run } = service({
      stagePending,
      run: vi.fn(async () => { throw unrelated; }) as unknown as PublicD1WhatsAppVisualDependencies["run"],
    });
    await expect(run(input())).rejects.toBe(unrelated);
    expect(stagePending).not.toHaveBeenCalled();
    expect(deps.renderCommittedMeal).not.toHaveBeenCalled();
  });
});
