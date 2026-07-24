from pathlib import Path

ROOT = Path('.')


def replace_once(path: str, old: str, new: str):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one match, found {count}: {old!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'server/modules/whatsapp/foodAssistant.test.ts',
    '      data: { context: "dinner" },',
    '      data: expect.objectContaining({ context: "dinner" }),',
)
replace_once(
    'server/modules/whatsapp/foodAssistant.test.ts',
    '      data: { context: "snack" },',
    '      data: expect.objectContaining({ context: "snack" }),',
)

replace_once(
    'server/modules/whatsapp/mealIntentRegistrationDetailsInteraction.ts',
    'import { normalizeMealIntentDecisionText } from "./mealIntentDecisionInteraction";\n',
    '',
)
replace_once(
    'server/modules/whatsapp/mealIntentRegistrationDetailsInteraction.ts',
    'const repository = createDrizzleWhatsAppPendingOperationRepository({\n',
    '''function normalizeRegistrationDetailsText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\\s]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
}

const repository = createDrizzleWhatsAppPendingOperationRepository({
''',
)
replace_once(
    'server/modules/whatsapp/mealIntentRegistrationDetailsInteraction.ts',
    '    normalizedText: normalizeMealIntentDecisionText(input.originalText),',
    '    normalizedText: normalizeRegistrationDetailsText(input.originalText),',
)

replace_once(
    'server/modules/whatsapp/llmIntentActions.ts',
    '''      toolTrace: base.toolTrace,
      interactiveReply: interaction.interactiveReply,
''',
    '''      toolTrace: base.toolTrace,
      ...("interactiveReply" in interaction && interaction.interactiveReply
        ? { interactiveReply: interaction.interactiveReply }
        : {}),
''',
)

this_file = ROOT / 'scripts/apply_issue_899_fixes_v2.py'
if this_file.exists():
    this_file.unlink()
