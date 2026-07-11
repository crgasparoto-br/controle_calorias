from pathlib import Path

ROOT = Path('.')

def read(path):
    return (ROOT / path).read_text()

def write(path, content):
    (ROOT / path).write_text(content)

def replace_once(path, old, new):
    content = read(path)
    if old not in content:
        raise RuntimeError(f'Pattern not found in {path}: {old[:120]!r}')
    write(path, content.replace(old, new, 1))

path = 'server/modules/whatsapp/deleteIntent.ts'
replace_once(path,
'''type PendingDeleteIntent = {
  kind: "delete_meal" | "delete_food_from_meal";
  mealId: number;
  mealLabel: string;
  mealOccurredAt: string;
  itemIndex?: number;
  itemName?: string;
};
''',
'''type PendingDeleteIntent = {
  kind: "delete_meal" | "delete_food_from_meal";
  mealId: number;
  mealLabel: string;
  mealOccurredAt: string;
  itemIndex?: number;
  itemName?: string;
};

type PendingDeleteSelection = {
  kind: "selection";
  targetFoodName: string;
  candidates: PendingDeleteIntent[];
};

type PendingDeleteOperation = PendingDeleteIntent | PendingDeleteSelection;
''')
replace_once(path,
'''function isCancellationText(normalized: string) {
  return ["nao", "cancelar", "cancela", "parar", "desfazer", "nao excluir", "não excluir", "nao remover", "não remover"].includes(normalized);
}
''',
'''function isCancellationText(normalized: string) {
  return ["nao", "cancelar", "cancela", "parar", "desfazer", "nao excluir", "não excluir", "nao remover", "não remover"].includes(normalized);
}

function parseSelectionIndex(normalized: string) {
  const ordinalWords: Record<string, number> = {
    primeiro: 0,
    primeira: 0,
    segundo: 1,
    segunda: 1,
    terceiro: 2,
    terceira: 2,
    quarto: 3,
    quarta: 3,
    quinto: 4,
    quinta: 4,
  };
  for (const [word, index] of Object.entries(ordinalWords)) {
    if (new RegExp(`\\b${word}\\b`).test(normalized)) return index;
  }
  const numeric = normalized.match(/(?:^|\\b)(\\d{1,2})(?:\\b|$)/);
  return numeric ? Number(numeric[1]) - 1 : null;
}
''')
replace_once(path,
'''function buildAmbiguousFoodMatchesReply(targetFoodName: string, matches: FoodMatch[]) {
''',
'''async function createPendingDeleteSelection(
  userId: number,
  targetFoodName: string,
  matches: FoodMatch[],
): Promise<WhatsappDeleteIntentResult> {
  const candidates: PendingDeleteIntent[] = matches.map(match => ({
    kind: "delete_food_from_meal",
    mealId: match.meal.id,
    mealLabel: match.meal.mealLabel,
    mealOccurredAt: new Date(match.meal.occurredAt).toISOString(),
    itemIndex: match.itemIndex,
    itemName: match.item.foodName,
  }));
  const pending: PendingDeleteSelection = { kind: "selection", targetFoodName, candidates };
  await pendingOperationRepository.createPendingOperation({
    userId,
    type: PENDING_DELETE_TYPE,
    origin: PENDING_DELETE_ORIGIN,
    ttlMs: PENDING_DELETE_TTL_MS,
    target: pending,
  });
  return {
    handled: true,
    action: "clarification_needed",
    reply: buildAmbiguousFoodMatchesReply(targetFoodName, matches),
    eventType: "whatsapp.intent.delete_food_selection_requested",
    detail: "Seleção destrutiva persistida antes da confirmação; nenhum item foi removido.",
    data: { destructiveActionBlocked: true, candidateCount: candidates.length },
  };
}

function buildAmbiguousFoodMatchesReply(targetFoodName: string, matches: FoodMatch[]) {
''')
replace_once(path,
'''    if (matches.length > 1) {
      return buildClarificationResult({
        ...detection,
        reply: buildAmbiguousFoodMatchesReply(detection.targetFoodName, matches),
        eventType: "whatsapp.intent.delete_food_clarification_needed",
        detail: "Comando destrutivo de alimento por nome com múltiplos candidatos compatíveis no contexto lógico do dia.",
      });
    }
''',
'''    if (matches.length > 1) {
      return createPendingDeleteSelection(userId, detection.targetFoodName, matches);
    }
''')
replace_once(path,
'''  if (items.length > 1) {
    const options = items.map((item, index) => `${index + 1}. ${item.foodName}`).join("\n");
    return buildClarificationResult({
      ...detection,
      reply: `Encontrei mais de um alimento na refeição mais recente. Qual deseja remover?\n${options}\n\nVocê também pode responder: remover último alimento.`,
      eventType: "whatsapp.intent.delete_food_clarification_needed",
      detail: "Comando destrutivo de alimento com múltiplos itens possíveis.",
    });
  }
''',
'''  if (items.length > 1) {
    const matches: FoodMatch[] = items.map((item, itemIndex) => ({ meal: latestMeal, item, itemIndex }));
    return createPendingDeleteSelection(userId, "alimento", matches);
  }
''')
replace_once(path,
'''  const item = latestMeal.items[pending.itemIndex];
  const nextItems = latestMeal.items.filter((_item, index) => index !== pending.itemIndex);
''',
'''  let resolvedItemIndex = pending.itemIndex;
  const itemAtOriginalIndex = latestMeal.items[resolvedItemIndex];
  if (!itemAtOriginalIndex || normalizeDeleteIntentText(itemAtOriginalIndex.foodName) !== normalizeDeleteIntentText(pending.itemName ?? "")) {
    const currentMatches = latestMeal.items
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => normalizeDeleteIntentText(candidate.foodName) === normalizeDeleteIntentText(pending.itemName ?? ""));
    if (currentMatches.length !== 1) {
      return {
        handled: true,
        action: "clarification_needed",
        reply: "A refeição mudou desde a seleção. Nada foi excluído; faça o pedido novamente para eu confirmar o item atual.",
        eventType: "whatsapp.intent.delete_food_stale_selection",
        detail: "Seleção de alimento ficou obsoleta antes da confirmação e foi bloqueada.",
        data: { mealId: pending.mealId, deleteIntentKind: pending.kind },
      };
    }
    resolvedItemIndex = currentMatches[0].index;
  }

  const item = latestMeal.items[resolvedItemIndex];
  const nextItems = latestMeal.items.filter((_item, index) => index !== resolvedItemIndex);
''')
replace_once(path,
'''  const pendingRow: WhatsAppPendingOperationRecord | null = await pendingOperationRepository.getActivePendingOperation(userId);
  if (pendingRow && pendingRow.type === PENDING_DELETE_TYPE) {
    const pending = pendingRow.target as PendingDeleteIntent;
    if (isCancellationText(normalized)) {
      await pendingOperationRepository.cancelPendingOperation(pendingRow.id);
      return buildCancellationResult();
    }
    if (isConfirmationText(normalized)) {
      const claim = await pendingOperationRepository.claimPendingOperation({ id: pendingRow.id, expectedVersion: pendingRow.version });
      if (!claim.claimed) {
        // Outra requisição/instância já consumiu esta pendência (issue #766: consumo atômico, no máximo uma execução).
        return null;
      }
      return confirmPendingDelete(userId, pending);
    }
  }
''',
'''  const pendingRow: WhatsAppPendingOperationRecord | null = await pendingOperationRepository.getActivePendingOperation(userId);
  if (pendingRow && pendingRow.type === PENDING_DELETE_TYPE) {
    const pending = pendingRow.target as PendingDeleteOperation;
    if (isCancellationText(normalized)) {
      await pendingOperationRepository.cancelPendingOperation(pendingRow.id);
      return buildCancellationResult();
    }

    if (pending.kind === "selection") {
      const selectedIndex = parseSelectionIndex(normalized);
      if (selectedIndex !== null) {
        const selected = pending.candidates[selectedIndex];
        if (!selected) {
          return {
            handled: true,
            action: "clarification_needed",
            reply: `A opção ${selectedIndex + 1} não existe. Escolha um número entre 1 e ${pending.candidates.length}, ou responda CANCELAR.`,
            eventType: "whatsapp.intent.delete_food_selection_invalid",
            detail: "Índice informado não existe na seleção destrutiva persistida.",
            data: { destructiveActionBlocked: true, candidateCount: pending.candidates.length },
          };
        }
        const claim = await pendingOperationRepository.claimPendingOperation({ id: pendingRow.id, expectedVersion: pendingRow.version });
        if (!claim.claimed) return null;
        await pendingOperationRepository.createPendingOperation({
          userId,
          type: PENDING_DELETE_TYPE,
          origin: PENDING_DELETE_ORIGIN,
          ttlMs: PENDING_DELETE_TTL_MS,
          target: selected,
        });
        return buildPendingResult(selected);
      }

      return {
        handled: true,
        action: "clarification_needed",
        reply: `Escolha uma das opções de 1 a ${pending.candidates.length} (por exemplo: o segundo) ou responda CANCELAR.`,
        eventType: "whatsapp.intent.delete_food_selection_needed",
        detail: "Pendência de seleção continua ativa; nenhuma exclusão foi executada.",
        data: { destructiveActionBlocked: true, candidateCount: pending.candidates.length },
      };
    }

    if (isConfirmationText(normalized)) {
      const claim = await pendingOperationRepository.claimPendingOperation({ id: pendingRow.id, expectedVersion: pendingRow.version });
      if (!claim.claimed) return null;
      return confirmPendingDelete(userId, pending);
    }
  }
''')

print('persistent selection patch applied')
