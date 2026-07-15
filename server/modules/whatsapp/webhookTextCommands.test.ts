import { beforeEach, describe, expect, it, vi } from "vitest";

const relabelUserMealsMock = vi.fn(async () => []);
const listUserMealsMock = vi.fn(async () => []);

vi.mock("drizzle-orm", () => ({
  eq: (col: { name: string }, val: unknown) => ({ __op: "eq", col, val }),
  desc: (col: { name: string }) => ({ __op: "desc", col }),
  and: (...conditions: unknown[]) => ({ __op: "and", conditions }),
}));

type Row = Record<string, unknown>;
type Condition = { __op: "eq"; col: { name: string }; val: unknown } | { __op: "and"; conditions: Condition[] } | { __op: "desc"; col: { name: string } };

function createFakePendingOperationDb() {
  let rows: Row[] = [];
  let nextId = 1;

  function matches(row: Row, condition?: Condition): boolean {
    if (!condition) return true;
    if (condition.__op === "eq") return row[condition.col.name] === condition.val;
    if (condition.__op === "and") return condition.conditions.every(inner => matches(row, inner));
    return true;
  }

  function createSelectChain() {
    let whereCondition: Condition | undefined;
    let limitValue: number | undefined;
    const resolve = () => {
      let result = rows.filter(row => matches(row, whereCondition));
      result = [...result].sort((a, b) => (b.id as number) - (a.id as number));
      if (limitValue !== undefined) result = result.slice(0, limitValue);
      return result.map(row => ({ ...row }));
    };
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn((condition: Condition) => { whereCondition = condition; return chain; }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn((value: number) => { limitValue = value; return Promise.resolve(resolve()); }),
    };
    return chain;
  }

  return {
    select: vi.fn(() => ({ from: vi.fn(() => createSelectChain()) })),
    insert: vi.fn(() => ({
      values: vi.fn((payload: Row) => {
        const id = nextId++;
        rows.push({ id, ...payload });
        return Promise.resolve({ insertId: id });
      }),
    })),
    update: vi.fn(() => {
      let setPayload: Row = {};
      const chain: any = {
        set: vi.fn((payload: Row) => { setPayload = payload; return chain; }),
        where: vi.fn((condition: Condition) => {
          const matching = rows.filter(row => matches(row, condition));
          for (const row of matching) Object.assign(row, setPayload);
          return Promise.resolve({ affectedRows: matching.length });
        }),
      };
      return chain;
    }),
    reset() {
      rows = [];
      nextId = 1;
    },
  };
}

const fakeDb = createFakePendingOperationDb();

vi.mock("../../db", () => ({
  relabelUserMeals: relabelUserMealsMock,
  listUserMeals: listUserMealsMock,
  getDb: vi.fn(async () => fakeDb),
  logPersistenceWarning: vi.fn(),
}));

const {
  buildWaterLogReply,
  buildWeightLogReply,
  detectWaterLogFromMessage,
  detectWeightLogFromMessage,
  detectWhatsAppAction,
  handlePendingWhatsAppConfirmation,
  handleWhatsAppAction,
} = await import("./webhookTextCommands");

function textMessage(body: string) {
  return { text: { body } };
}

describe("webhookTextCommands", () => {
  beforeEach(() => {
    fakeDb.reset();
    relabelUserMealsMock.mockClear();
    listUserMealsMock.mockReset().mockResolvedValue([]);
  });

  describe("detectWaterLogFromMessage", () => {
    it("reconhece quantidade em mililitros", () => {
      expect(detectWaterLogFromMessage(textMessage("bebi 300ml de agua"))).toEqual({ amountMl: 300 });
    });

    it("reconhece quantidade em litros", () => {
      expect(detectWaterLogFromMessage(textMessage("1,5 litros de agua"))).toEqual({ amountMl: 1500 });
    });

    it("ignora mensagens que misturam comida com água", () => {
      expect(detectWaterLogFromMessage(textMessage("300ml de agua e um pao"))).toBeNull();
    });

    it("ignora mensagens com mídia anexada", () => {
      expect(detectWaterLogFromMessage({ text: { body: "300ml de agua" }, image: { id: "img" } })).toBeNull();
    });
  });

  describe("detectWeightLogFromMessage", () => {
    it("reconhece peso em kg", () => {
      expect(detectWeightLogFromMessage(textMessage("meu peso hoje é 82,5kg"))).toEqual({ weightKg: 82.5 });
    });

    it("ignora valores fora da faixa aceitável", () => {
      expect(detectWeightLogFromMessage(textMessage("pesei 10kg"))).toBeNull();
    });
  });

  describe("reply builders", () => {
    it("formata mensagem de água com horário em São Paulo", () => {
      const reply = buildWaterLogReply(300, new Date("2026-04-20T11:14:00-03:00"));
      expect(reply).toContain("Água registrada");
      expect(reply).toContain("*Quantidade:* 300 ml");
      expect(reply).toContain("*Data:* 11:14");
    });

    it("formata mensagem de peso com horário em São Paulo", () => {
      const reply = buildWeightLogReply(82.5, new Date("2026-04-20T11:14:00-03:00"));
      expect(reply).toContain("Peso registrado");
      expect(reply).toContain("*Peso:* 82.5 kg");
      expect(reply).toContain("*Data:* 11:14");
    });
  });

  describe("detectWhatsAppAction", () => {
    it("reconhece comando de reclassificação de refeição", () => {
      const action = detectWhatsAppAction(textMessage("Mudar a refeição lanche para café da manhã"));
      expect(action).toEqual({
        kind: "reclassify_recent_meals",
        fromMealLabel: "Lanche",
        toMealLabel: "Café da manhã",
      });
    });

    it("ignora quando origem e destino são a mesma refeição", () => {
      expect(detectWhatsAppAction(textMessage("Mudar a refeição lanche para lanche"))).toBeNull();
    });
  });

  describe("handleWhatsAppAction", () => {
    it("pede esclarecimento quando não há refeições recentes compatíveis", async () => {
      listUserMealsMock.mockResolvedValueOnce([]);
      const result = await handleWhatsAppAction({ kind: "reclassify_recent_meals", fromMealLabel: "Lanche", toMealLabel: "Café da manhã" }, 42);
      expect(result).toEqual(expect.objectContaining({
        handled: true,
        eventType: "whatsapp.action_clarification_needed",
      }));
    });

    it("cria pendência durável quando todas as refeições recentes são compatíveis", async () => {
      listUserMealsMock.mockResolvedValueOnce([
        { id: 1, mealLabel: "Lanche", source: "whatsapp", occurredAt: new Date().toISOString() },
      ]);

      const result = await handleWhatsAppAction({ kind: "reclassify_recent_meals", fromMealLabel: "Lanche", toMealLabel: "Café da manhã" }, 42);
      expect(result.eventType).toBe("whatsapp.action_confirmation_requested");

      const pending = await handlePendingWhatsAppConfirmation(textMessage("outra coisa"), 42);
      expect(pending).toBeNull(); // mensagem não é confirmação nem cancelamento: pendência continua ativa
    });
  });

  describe("handlePendingWhatsAppConfirmation", () => {
    async function createPending(userId: number) {
      listUserMealsMock.mockResolvedValueOnce([
        { id: 1, mealLabel: "Lanche", source: "whatsapp", occurredAt: new Date().toISOString() },
      ]);
      await handleWhatsAppAction({ kind: "reclassify_recent_meals", fromMealLabel: "Lanche", toMealLabel: "Café da manhã" }, userId);
    }

    it("aplica a ação ao confirmar, revalidando o alvo no banco atual", async () => {
      await createPending(1);
      listUserMealsMock.mockResolvedValueOnce([
        { id: 1, mealLabel: "Lanche", source: "whatsapp", occurredAt: new Date().toISOString() },
      ]);
      relabelUserMealsMock.mockResolvedValueOnce([{ id: 1 }]);

      const result = await handlePendingWhatsAppConfirmation(textMessage("sim"), 1);
      expect(result).toEqual(expect.objectContaining({ eventType: "whatsapp.action_applied" }));
      expect(relabelUserMealsMock).toHaveBeenCalledWith(expect.objectContaining({ mealIds: [1] }));
    });

    it("cancela a pendência sem alterar registros", async () => {
      await createPending(2);
      const result = await handlePendingWhatsAppConfirmation(textMessage("cancela"), 2);
      expect(result).toEqual(expect.objectContaining({ eventType: "whatsapp.action_cancelled" }));
      expect(relabelUserMealsMock).not.toHaveBeenCalled();
    });

    it("nao aplica novamente uma pendência já cancelada", async () => {
      await createPending(3);
      await handlePendingWhatsAppConfirmation(textMessage("cancela"), 3);

      const result = await handlePendingWhatsAppConfirmation(textMessage("sim"), 3);
      expect(result).toBeNull();
      expect(relabelUserMealsMock).not.toHaveBeenCalled();
    });

    it("apenas uma de duas confirmações concorrentes aplica a alteração", async () => {
      await createPending(4);
      listUserMealsMock.mockResolvedValue([
        { id: 1, mealLabel: "Lanche", source: "whatsapp", occurredAt: new Date().toISOString() },
      ]);
      relabelUserMealsMock.mockResolvedValue([{ id: 1 }]);

      const [first, second] = await Promise.all([
        handlePendingWhatsAppConfirmation(textMessage("sim"), 4),
        handlePendingWhatsAppConfirmation(textMessage("sim"), 4),
      ]);

      const applied = [first, second].filter(result => result?.eventType === "whatsapp.action_applied");
      expect(applied).toHaveLength(1);
      expect(relabelUserMealsMock).toHaveBeenCalledTimes(1);
    });
  });
});
