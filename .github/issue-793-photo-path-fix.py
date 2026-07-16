from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    if old not in text:
        raise RuntimeError(f"pattern not found in {path}: {old[:100]!r}")
    file_path.write_text(text.replace(old, new, 1))


# Public photo confirmation receives civil time and converts using the owner's timezone.
replace_once(
    "server/nutritionRouter.ts",
    '''const waterLogMutationSchema = waterLogSchema
  .omit({ occurredAt: true })
  .extend({ dateTimeLocal: ownerDateTimeLocalSchema });
''',
    '''const waterLogMutationSchema = waterLogSchema
  .omit({ occurredAt: true })
  .extend({ dateTimeLocal: ownerDateTimeLocalSchema });
const confirmFoodPhotoAnalysisMutationSchema = confirmFoodPhotoAnalysisSchema
  .omit({ occurredAt: true })
  .extend({ dateTimeLocal: ownerDateTimeLocalSchema });
''',
)

replace_once(
    "server/nutritionRouter.ts",
    '''    confirm: protectedProcedure
      .input(confirmFoodPhotoAnalysisSchema)
      .mutation(async ({ ctx, input }) => {
        const result = await confirmFoodPhotoAnalysis(ctx.user.id, input);
        void analyticsService.track("meal_created", {
          source: "ai_draft",
          meal_label_category: mealLabelCategory(input.mealLabel),
          item_count: input.items.length,
          has_notes: Boolean(input.notes?.trim()),
          scheduled_for_future: new Date(input.occurredAt).getTime() > Date.now(),
        });
        return result;
      }),
''',
    '''    confirm: protectedProcedure
      .input(confirmFoodPhotoAnalysisMutationSchema)
      .mutation(async ({ ctx, input }) => {
        const timeZone = await getEffectiveUserTimeZone(ctx.user.id);
        const { dateTimeLocal, ...confirmationInput } = input;
        const occurredAt = toOwnerOccurredAt(dateTimeLocal, timeZone);
        const result = await confirmFoodPhotoAnalysis(ctx.user.id, {
          ...confirmationInput,
          occurredAt,
        });
        void analyticsService.track("meal_created", {
          source: "ai_draft",
          meal_label_category: mealLabelCategory(input.mealLabel),
          item_count: input.items.length,
          has_notes: Boolean(input.notes?.trim()),
          scheduled_for_future: new Date(occurredAt).getTime() > Date.now(),
        });
        return result;
      }),
''',
)

# Existing integration test uses the public civil contract.
path = Path("server/nutritionRouter.test.ts")
text = path.read_text()
text = text.replace(
    'occurredAt: "2026-04-22T15:00:00.000Z",',
    'dateTimeLocal: ownerDateTimeLocal("2026-04-22T15:00:00.000Z"),',
    1,
)
text = text.replace(
    'occurredAt: "2026-04-22T15:30:00.000Z",',
    'dateTimeLocal: ownerDateTimeLocal("2026-04-22T15:30:00.000Z"),',
    1,
)

assertion_anchor = '    expect(meal.items[0].foodName).toBe("Arroz integral corrigido");\n'
assertion = '    expect(new Date(Number(meal.occurredAt)).toISOString()).toBe("2026-04-22T15:00:00.000Z");\n'
if assertion_anchor not in text:
    raise RuntimeError("photo confirmation assertion anchor not found")
text = text.replace(assertion_anchor, assertion_anchor + assertion, 1)
path.write_text(text)

# Architectural guard prevents exposing the internal absolute schema directly.
replace_once(
    "scripts/timezone-architecture.ts",
    '''    if (filePath.endsWith("server/modules/quickEdit/schemas.ts")) {
      addPatternViolations({
        filePath,
        content: file.content,
        pattern: /occurredAt\\s*:\\s*z\\./g,
        message: "Contrato público temporal aceita occurredAt absoluto",
        failures,
      });
    }
''',
    '''    if (filePath.endsWith("server/modules/quickEdit/schemas.ts")) {
      addPatternViolations({
        filePath,
        content: file.content,
        pattern: /occurredAt\\s*:\\s*z\\./g,
        message: "Contrato público temporal aceita occurredAt absoluto",
        failures,
      });
    }

    if (filePath === "server/nutritionRouter.ts") {
      addPatternViolations({
        filePath,
        content: file.content,
        pattern: /\\.input\\(\\s*confirmFoodPhotoAnalysisSchema\\s*\\)/g,
        message: "Confirmação pública de foto expõe o schema temporal absoluto interno",
        failures,
      });
    }
''',
)

replace_once(
    "scripts/timezone-architecture.test.ts",
    '''  it("permite o contrato central, fixtures e formatação explícita", () => {
''',
    '''  it("bloqueia schema temporal absoluto na confirmação pública de foto", () => {
    expect(violations("server/nutritionRouter.ts", `
      confirm: protectedProcedure.input(confirmFoodPhotoAnalysisSchema).mutation(handler),
    `)).toEqual([
      expect.stringContaining("Confirmação pública de foto"),
    ]);
  });

  it("permite o contrato central, fixtures e formatação explícita", () => {
''',
)

replace_once(
    "docs/design-docs/timezone-frontend.md",
    '''Formulários autenticados enviam `dateTimeLocal` como horário civil. A mutation resolve o timezone efetivo do dono e converte no servidor com o helper central.''',
    '''Formulários autenticados, inclusive a confirmação de análise de foto, enviam `dateTimeLocal` como horário civil. A mutation resolve o timezone efetivo do dono e converte no servidor com o helper central.''',
)

print("photo analysis temporal path migrated")
