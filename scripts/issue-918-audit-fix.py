from pathlib import Path


def insert_before_last_closure(path: str, addition: str, sentinel: str) -> None:
    file = Path(path)
    content = file.read_text(encoding="utf-8")
    if sentinel in content:
        print(f"{path}: addition already present")
        return
    marker = "\n});\n"
    position = content.rfind(marker)
    if position < 0:
        raise SystemExit(f"Final describe closure not found in {path}")
    file.write_text(content[:position] + addition + content[position:], encoding="utf-8")
    print(f"{path}: tests added")


def replace_required(path: str, old: str, new: str) -> None:
    file = Path(path)
    content = file.read_text(encoding="utf-8")
    if new in content:
        print(f"{path}: replacement already present")
        return
    if old not in content:
        raise SystemExit(f"Expected text not found in {path}: {old[:80]!r}")
    file.write_text(content.replace(old, new, 1), encoding="utf-8")
    print(f"{path}: replacement applied")


Path("server/modules/whatsapp/replacementCommandDetection.ts").write_text(
    '''export const WHATSAPP_FOOD_REPLACEMENT_COMMAND_PATTERN =
  "(?:(?:n[aã]o)\\s+(?:é|e|era)(?=\\s|$|[,;:!?])|(?:trocar|troque|troca|mudar|alterar|corrigir|substituir|substitua)\\b(?=\\s|$|[,;:!?]))";

export function isWhatsappFoodReplacementCommandStart(text: string) {
  return new RegExp(
    `^\\s*${WHATSAPP_FOOD_REPLACEMENT_COMMAND_PATTERN}`,
    "i"
  ).test(text);
}

export function countWhatsappFoodReplacementCommands(text: string) {
  return (
    text.match(
      new RegExp(WHATSAPP_FOOD_REPLACEMENT_COMMAND_PATTERN, "gi")
    ) ?? []
  ).length;
}

export function hasMultipleWhatsappFoodReplacementCommands(text: string) {
  return countWhatsappFoodReplacementCommands(text) > 1;
}
''',
    encoding="utf-8",
)
print("replacementCommandDetection.ts: canonical detector written")

contextual_path = Path("server/modules/whatsapp/contextualFoodReplacementIntent.ts")
contextual = contextual_path.read_text(encoding="utf-8")
import_line = 'import { requestWhatsappLatestFoodCorrectionQuantity } from "./foodQuantityClarification";\n'
import_block = import_line + '''import {
  isWhatsappFoodReplacementCommandStart,
  WHATSAPP_FOOD_REPLACEMENT_COMMAND_PATTERN,
} from "./replacementCommandDetection";
'''
if "WHATSAPP_FOOD_REPLACEMENT_COMMAND_PATTERN" not in contextual:
    if import_line not in contextual:
        raise SystemExit("contextualFoodReplacementIntent.ts: import anchor not found")
    contextual = contextual.replace(import_line, import_block, 1)

start_marker = "const REPLACEMENT_COMMAND_START_PATTERN ="
end_marker = "const QUANTITY_ADJUSTMENT_TARGET ="
if start_marker in contextual:
    start = contextual.index(start_marker)
    end = contextual.index(end_marker, start)
    separator_block = '''const REPLACEMENT_SEGMENT_SEPARATOR = new RegExp(
  `(?:[ \\t]*\\r?\\n[ \\t]*)+|\\s*[,;]\\s*(?=${WHATSAPP_FOOD_REPLACEMENT_COMMAND_PATTERN})|\\s+e\\s+(?=n[aã]o\\b)|\\s+(?=${WHATSAPP_FOOD_REPLACEMENT_COMMAND_PATTERN})`,
  "i"
);
'''
    contextual = contextual[:start] + separator_block + contextual[end:]
elif "WHATSAPP_FOOD_REPLACEMENT_COMMAND_PATTERN" not in contextual:
    raise SystemExit("contextualFoodReplacementIntent.ts: parser constants not found")

contextual = contextual.replace(
    "REPLACEMENT_COMMAND_START.test(segment)",
    "isWhatsappFoodReplacementCommandStart(segment)",
)
if "REPLACEMENT_COMMAND_START" in contextual:
    raise SystemExit("contextualFoodReplacementIntent.ts: legacy detector remains")
contextual_path.write_text(contextual, encoding="utf-8")
print("contextualFoodReplacementIntent.ts: parser centralized")

insert_before_last_closure(
    "server/modules/whatsapp/contextualFoodReplacementIntent.multiline.test.ts",
    r'''

  it.each([
    [
      "nova linha termina em 'não é'",
      "Não é requeijão, é maionese.\nNão é",
    ],
    [
      "ponto e vírgula termina em 'trocar'",
      "Trocar requeijão por maionese;Trocar",
    ],
    [
      "vírgula termina em 'substituir'",
      "Substituir requeijão por maionese,Substituir",
    ],
    [
      "comando incompleto termina com pontuação",
      "Não é requeijão, é maionese; Não é,",
    ],
  ])("bloqueia o lote quando %s", async (_label, text) => {
    const result = await executeWhatsappContextualFoodReplacementIntent(42, {
      text,
      receivedAt: new Date("2026-07-26T12:05:00.000Z"),
    });

    expect(listMealsMock).not.toHaveBeenCalled();
    expect(updateMealsWithCompensationMock).not.toHaveBeenCalled();
    expect(createPendingMealItemSelectionMock).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: "clarification_needed",
        eventType: "whatsapp.intent.clarification_needed",
        reply: expect.stringContaining("todas as substituições"),
      })
    );
  });

  it("aplica ações claras em refeições diferentes no mesmo lote", async () => {
    listMealsMock.mockResolvedValue([
      meal(1, [item("Requeijão")]),
      {
        ...meal(2, [item("Presunto")]),
        mealLabel: "Jantar",
        occurredAt: new Date("2026-07-26T11:55:00.000Z").getTime(),
      },
    ]);

    const result = await executeWhatsappContextualFoodReplacementIntent(42, {
      text: "Não é requeijão, é maionese.\nNão é presunto, é mortadela defumada",
      receivedAt: new Date("2026-07-26T12:05:00.000Z"),
    });

    expect(updateMealsWithCompensationMock).toHaveBeenCalledOnce();
    const changes = updateMealsWithCompensationMock.mock.calls[0]?.[1];
    expect(changes).toEqual([
      expect.objectContaining({
        after: expect.objectContaining({
          id: 1,
          items: [expect.objectContaining({ foodName: "maionese" })],
        }),
      }),
      expect.objectContaining({
        after: expect.objectContaining({
          id: 2,
          items: [
            expect.objectContaining({ foodName: "mortadela defumada" }),
          ],
        }),
      }),
    ]);
    expect(composeWhatsAppMealActionRepliesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            options: expect.objectContaining({
              actionLines: ["Requeijão → maionese"],
            }),
          }),
          expect.objectContaining({
            options: expect.objectContaining({
              actionLines: ["Presunto → mortadela defumada"],
            }),
          }),
        ],
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        action: "meal_item_replaced",
        data: expect.objectContaining({ mealIds: [1, 2] }),
      })
    );
  });
''',
    "nova linha termina em 'não é'",
)

insert_before_last_closure(
    "server/modules/whatsapp/service.multilineReplacement.test.ts",
    r'''

  it.each([
    [
      "linha final incompleta",
      "Não é requeijão, é maionese.\nNão é",
      "issue-918-simulator-incomplete-line",
    ],
    [
      "verbo trocar incompleto",
      "Trocar requeijão por maionese;Trocar",
      "issue-918-simulator-incomplete-swap",
    ],
    [
      "verbo substituir incompleto",
      "Substituir requeijão por maionese,Substituir",
      "issue-918-simulator-incomplete-substitute",
    ],
  ])(
    "encaminha %s ao handler e bloqueia fallback",
    async (_label, text, messageId) => {
      executeWhatsappContextualFoodReplacementIntentMock.mockResolvedValueOnce({
        action: "clarification_needed",
        reply: "Reenvie todas as substituições completas.",
        eventType: "whatsapp.intent.clarification_needed",
        detail: "Pedido de substituição com segmento incompleto.",
      });

      const result = await simulateWhatsappInbound(42, {
        text,
        receivedAt: new Date("2026-07-26T12:05:00.000Z"),
        userTimezone: "America/Sao_Paulo",
        messageId,
      });

      expect(
        executeWhatsappContextualFoodReplacementIntentMock
      ).toHaveBeenCalledOnce();
      expect(result).toEqual(
        expect.objectContaining({
          handled: true,
          action: "clarification_needed",
          eventType: "whatsapp.intent.clarification_needed",
        })
      );
      expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
      expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
      expect(processMealDraftMock).not.toHaveBeenCalled();
    }
  );

  it("ignora a reentrega do mesmo messageId sem reaplicar o lote", async () => {
    const text =
      "Não é requeijão, é maionese.\nNão é presunto, é mortadela defumada";
    const receivedAt = new Date("2026-07-26T12:05:00.000Z");

    const first = await simulateWhatsappInbound(42, {
      text,
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      messageId: "issue-918-simulator-retry",
    });
    const second = await simulateWhatsappInbound(42, {
      text,
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      messageId: "issue-918-simulator-retry",
    });

    expect(first.action).toBe("meal_item_replaced");
    expect(second).toEqual(
      expect.objectContaining({
        action: "duplicate_inbound_message_ignored",
        eventType: "whatsapp.idempotency.message_retry_ignored",
        data: expect.objectContaining({
          duplicateKind: "message_id_retry",
        }),
      })
    );
    expect(
      executeWhatsappContextualFoodReplacementIntentMock
    ).toHaveBeenCalledOnce();
  });
''',
    "issue-918-simulator-incomplete-line",
)

insert_before_last_closure(
    "server/whatsappIntentWebhook.multilineReplacement.test.ts",
    r'''

  it.each([
    [
      "linha final incompleta",
      "Não é requeijão, é maionese.\nNão é",
      "wamid-issue-918-webhook-incomplete-line",
    ],
    [
      "verbo trocar incompleto",
      "Trocar requeijão por maionese;Trocar",
      "wamid-issue-918-webhook-incomplete-swap",
    ],
    [
      "verbo substituir incompleto",
      "Substituir requeijão por maionese,Substituir",
      "wamid-issue-918-webhook-incomplete-substitute",
    ],
  ])(
    "envia esclarecimento e bloqueia fallback quando há %s",
    async (_label, text, messageId) => {
      executeWhatsappContextualFoodReplacementIntentMock.mockResolvedValueOnce({
        action: "clarification_needed",
        reply: "Reenvie todas as substituições completas.",
        eventType: "whatsapp.intent.clarification_needed",
        detail: "Pedido de substituição com segmento incompleto.",
      });
      const req = createTextWebhookRequest(text, messageId);
      const res = createResponse();

      await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

      expect(
        executeWhatsappContextualFoodReplacementIntentMock
      ).toHaveBeenCalledOnce();
      expect(sendWhatsAppLogicalDomainReplyMock).toHaveBeenCalledOnce();
      expect(sendWhatsAppLogicalDomainReplyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 42,
          replyText: "Reenvie todas as substituições completas.",
        })
      );
      expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
      expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
      expect(processMealDraftFallbackMock).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    }
  );
''',
    "wamid-issue-918-webhook-incomplete-line",
)

replace_required(
    "docs/testing/whatsapp-response-contract-regression.md",
    "| Substituições multiline preservam todos os pares e bloqueiam lote incompleto | `contextualFoodReplacementIntent.multiline.test.ts`; smoke equivalente no simulador e webhook |",
    "| Substituições multiline preservam todos os pares e bloqueiam lote incompleto, inclusive quando o novo comando termina no próprio verbo (`não é`, `trocar` ou `substituir`) | `contextualFoodReplacementIntent.multiline.test.ts`; smoke equivalente no simulador e webhook |",
)
