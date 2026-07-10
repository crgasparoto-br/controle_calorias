import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  whatsappConversationMessages,
  whatsappConversations,
  whatsappMessageDomainLinks,
} from "../../drizzle/schema";
import { WHATSAPP_CONVERSATION_ACTIVE_TTL_MS } from "../modules/whatsapp/conversationPolicy";
import { createDrizzleWhatsAppConversationRepository } from "./whatsappConversationRepository";

vi.mock("drizzle-orm", () => ({
  eq: (col: { name: string }, val: unknown) => ({ __op: "eq", col, val }),
  asc: (col: { name: string }) => ({ __op: "asc", col }),
  desc: (col: { name: string }) => ({ __op: "desc", col }),
}));

type Row = Record<string, unknown>;
type Condition = { __op: "eq"; col: { name: string }; val: unknown } | { __op: "asc" | "desc"; col: { name: string } };

/**
 * Fake DB em memória que realmente filtra/ordena/gera id autoincrementado,
 * o suficiente para exercitar de forma genuína os critérios de persistência,
 * unicidade, ordenação, recuperação e isolamento exigidos pela issue #763.
 */
function createFakeDb() {
  const tables = new Map<unknown, Row[]>();
  const uniqueColumns = new Map<unknown, Set<string>>();
  let nextId = 1;

  function tableRows(table: unknown): Row[] {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table)!;
  }

  function applyWhere(rows: Row[], condition?: Condition): Row[] {
    if (!condition || condition.__op !== "eq") return rows;
    return rows.filter(row => row[condition.col.name] === condition.val);
  }

  function applyOrder(rows: Row[], conditions: Condition[]): Row[] {
    const sorted = [...rows];
    sorted.sort((a, b) => {
      for (const condition of conditions) {
        if (condition.__op !== "asc" && condition.__op !== "desc") continue;
        const key = condition.col.name;
        const av = a[key] instanceof Date ? (a[key] as Date).getTime() : a[key];
        const bv = b[key] instanceof Date ? (b[key] as Date).getTime() : b[key];
        if (av === bv) continue;
        const cmp = (av as number) < (bv as number) ? -1 : 1;
        return condition.__op === "asc" ? cmp : -cmp;
      }
      return 0;
    });
    return sorted;
  }

  function createSelectChain(table: unknown) {
    let whereCondition: Condition | undefined;
    let orderConditions: Condition[] = [];
    let limitValue: number | undefined;

    const resolve = () => {
      let rows = applyWhere(tableRows(table), whereCondition);
      if (orderConditions.length) rows = applyOrder(rows, orderConditions);
      if (limitValue !== undefined) rows = rows.slice(0, limitValue);
      return rows.map(row => ({ ...row }));
    };

    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn((condition: Condition) => {
        whereCondition = condition;
        return chain;
      }),
      orderBy: vi.fn((...conditions: Condition[]) => {
        orderConditions = conditions;
        return chain;
      }),
      limit: vi.fn((value: number) => {
        limitValue = value;
        return Promise.resolve(resolve());
      }),
      then: (resolveFn: (value: unknown) => unknown, rejectFn: (reason: unknown) => unknown) =>
        Promise.resolve(resolve()).then(resolveFn, rejectFn),
    };
    return chain;
  }

  function createInsertChain(table: unknown) {
    return {
      values: vi.fn((payload: Row) => {
        const uniqueSet = uniqueColumns.get(table);
        if (uniqueSet) {
          for (const columnName of uniqueSet) {
            if (payload[columnName] === undefined || payload[columnName] === null) continue;
            const clash = tableRows(table).some(row => row[columnName] === payload[columnName]);
            if (clash) {
              const error = new Error("Duplicate entry") as Error & { code?: string };
              error.code = "ER_DUP_ENTRY";
              throw error;
            }
          }
        }

        const id = nextId++;
        const row: Row = { id, ...payload };
        tableRows(table).push(row);
        return Promise.resolve({ insertId: id });
      }),
    };
  }

  function createUpdateChain(table: unknown) {
    let setPayload: Row = {};
    const chain: any = {
      set: vi.fn((payload: Row) => {
        setPayload = payload;
        return chain;
      }),
      where: vi.fn((condition: Condition) => {
        const rows = applyWhere(tableRows(table), condition);
        for (const row of rows) Object.assign(row, setPayload);
        return Promise.resolve(undefined);
      }),
    };
    return chain;
  }

  return {
    markUnique(table: unknown, columnName: string) {
      if (!uniqueColumns.has(table)) uniqueColumns.set(table, new Set());
      uniqueColumns.get(table)!.add(columnName);
    },
    select: vi.fn(() => ({ from: vi.fn((table: unknown) => createSelectChain(table)) })),
    insert: vi.fn((table: unknown) => createInsertChain(table)),
    update: vi.fn((table: unknown) => createUpdateChain(table)),
  };
}

function createRepository() {
  const db = createFakeDb();
  db.markUnique(whatsappConversationMessages, "idempotencyKey");
  const onWarning = vi.fn();
  const repository = createDrizzleWhatsAppConversationRepository({ getDb: async () => db, onWarning });
  return { db, onWarning, repository };
}

describe("createDrizzleWhatsAppConversationRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cria uma conversa para usuário sem histórico", async () => {
    const { repository } = createRepository();

    const conversation = await repository.createOrGetActiveConversation(1, null, "5511999999999");

    expect(conversation).not.toBeNull();
    expect(conversation?.userId).toBe(1);
    expect(conversation?.status).toBe("active");
  });

  it("reaproveita a conversa ativa dentro do TTL", async () => {
    const { repository } = createRepository();
    const now = new Date("2026-07-10T10:00:00Z");

    const first = await repository.createOrGetActiveConversation(1, null, "5511999999999", now);
    const later = new Date(now.getTime() + 5 * 60 * 1000);
    const second = await repository.createOrGetActiveConversation(1, null, "5511999999999", later);

    expect(second?.id).toBe(first?.id);
    expect(second?.status).toBe("active");
  });

  it("abre uma nova conversa após a expiração da anterior, sem apagar mensagens antigas", async () => {
    const { repository, db } = createRepository();
    const now = new Date("2026-07-10T10:00:00Z");

    const first = await repository.createOrGetActiveConversation(1, null, "5511999999999", now);
    await repository.appendMessage({
      conversationId: first!.id,
      userId: 1,
      direction: "inbound",
      externalMessageId: "wamid.old",
      contentType: "text",
      text: "mensagem antiga",
      occurredAt: now,
    });

    const afterTtl = new Date(now.getTime() + WHATSAPP_CONVERSATION_ACTIVE_TTL_MS + 1000);
    const second = await repository.createOrGetActiveConversation(1, null, "5511999999999", afterTtl);

    expect(second?.id).not.toBe(first?.id);
    expect(second?.status).toBe("active");

    const [oldConversation] = (db as any).select
      ? await (async () => {
          const rows = await (db.select() as any).from(whatsappConversations);
          return rows.filter((row: Row) => row.id === first?.id);
        })()
      : [];
    expect(oldConversation.status).toBe("expired");
    expect(oldConversation.endedAt).not.toBeNull();

    const oldMessages = await repository.findRecentMessages(first!.id);
    expect(oldMessages).toHaveLength(1);
    expect(oldMessages[0].sanitizedText).toBe("mensagem antiga");
  });

  it("persiste uma mensagem de texto", async () => {
    const { repository } = createRepository();
    const conversation = await repository.createOrGetActiveConversation(1, null, "5511999999999");

    const message = await repository.appendMessage({
      conversationId: conversation!.id,
      userId: 1,
      direction: "inbound",
      externalMessageId: "wamid.text-1",
      contentType: "text",
      text: "150g de frango e 100g de arroz",
      allowRawContentStorage: true,
      occurredAt: new Date("2026-07-10T12:00:00Z"),
    });

    expect(message).not.toBeNull();
    expect(message?.contentType).toBe("text");
    expect(message?.sanitizedText).toBeTruthy();
  });

  it("persiste uma mensagem de imagem com legenda e referência de mídia, sem armazenar binário", async () => {
    const { repository } = createRepository();
    const conversation = await repository.createOrGetActiveConversation(1, null, "5511999999999");

    const message = await repository.appendMessage({
      conversationId: conversation!.id,
      userId: 1,
      direction: "inbound",
      externalMessageId: "wamid.image-1",
      contentType: "image",
      captionText: "meu almoço",
      mediaStorageKey: "media/abc123.jpg",
      mediaMimeType: "image/jpeg",
      occurredAt: new Date("2026-07-10T12:05:00Z"),
    });

    expect(message?.contentType).toBe("image");
    expect(message?.mediaStorageKey).toBe("media/abc123.jpg");
    expect(message?.captionText).toBe("meu almoço");
  });

  it("persiste uma mensagem de áudio com transcrição", async () => {
    const { repository } = createRepository();
    const conversation = await repository.createOrGetActiveConversation(1, null, "5511999999999");

    const message = await repository.appendMessage({
      conversationId: conversation!.id,
      userId: 1,
      direction: "inbound",
      externalMessageId: "wamid.audio-1",
      contentType: "audio",
      transcript: "no jantar comi arroz e feijão",
      allowRawContentStorage: true,
      occurredAt: new Date("2026-07-10T20:00:00Z"),
    });

    expect(message?.contentType).toBe("audio");
    expect(message?.sanitizedTranscript).toBeTruthy();
  });

  it("persiste uma mensagem multimodal com mídia, transcrição e legenda no mesmo contrato", async () => {
    const { repository } = createRepository();
    const conversation = await repository.createOrGetActiveConversation(1, null, "5511999999999");

    const message = await repository.appendMessage({
      conversationId: conversation!.id,
      userId: 1,
      direction: "inbound",
      externalMessageId: "wamid.multi-1",
      contentType: "multimodal",
      mediaStorageKey: "media/label.jpg",
      captionText: "rótulo do produto",
      transcript: "corrige a quantidade para 80g",
      allowRawContentStorage: true,
      occurredAt: new Date("2026-07-10T21:00:00Z"),
    });

    expect(message?.contentType).toBe("multimodal");
    expect(message?.mediaStorageKey).toBe("media/label.jpg");
    expect(message?.sanitizedTranscript).toBeTruthy();
  });

  it("vincula a resposta enviada à mensagem recebida que a originou", async () => {
    const { repository } = createRepository();
    const conversation = await repository.createOrGetActiveConversation(1, null, "5511999999999");

    const inbound = await repository.appendMessage({
      conversationId: conversation!.id,
      userId: 1,
      direction: "inbound",
      externalMessageId: "wamid.in-1",
      contentType: "text",
      text: "quanto deu de proteína?",
      occurredAt: new Date("2026-07-10T12:10:00Z"),
    });
    const outbound = await repository.appendMessage({
      conversationId: conversation!.id,
      userId: 1,
      direction: "outbound",
      contentType: "text",
      text: "Deu 42g de proteína.",
      occurredAt: new Date("2026-07-10T12:10:05Z"),
    });

    await repository.linkResponse(inbound!.id, outbound!.id);

    const messages = await repository.findRecentMessages(conversation!.id);
    const updatedOutbound = messages.find(row => row.id === outbound!.id);
    expect(updatedOutbound?.respondsToMessageId).toBe(inbound!.id);
  });

  it("vincula uma mensagem a um registro de domínio (refeição)", async () => {
    const { repository } = createRepository();
    const conversation = await repository.createOrGetActiveConversation(1, null, "5511999999999");
    const message = await repository.appendMessage({
      conversationId: conversation!.id,
      userId: 1,
      direction: "inbound",
      externalMessageId: "wamid.meal-1",
      contentType: "text",
      text: "150g de frango",
      occurredAt: new Date("2026-07-10T12:00:00Z"),
    });

    await repository.linkDomainRecord(message!.id, { mealId: 42 });

    const links = await repository.findDomainLinksForMessage(message!.id);
    expect(links).toHaveLength(1);
    expect(links[0].mealId).toBe(42);
  });

  it("reentrega do mesmo message.id não duplica a mensagem", async () => {
    const { repository } = createRepository();
    const conversation = await repository.createOrGetActiveConversation(1, null, "5511999999999");
    const input = {
      conversationId: conversation!.id,
      userId: 1,
      direction: "inbound" as const,
      externalMessageId: "wamid.redelivered",
      contentType: "text" as const,
      text: "150g de frango",
      occurredAt: new Date("2026-07-10T12:00:00Z"),
    };

    const first = await repository.appendMessage(input);
    const redelivered = await repository.appendMessage(input);

    expect(redelivered?.id).toBe(first?.id);

    const messages = await repository.findRecentMessages(conversation!.id);
    expect(messages).toHaveLength(1);
  });

  it("mensagens fora de ordem são recuperadas ordenadas por occurredAt, com id como desempate", async () => {
    const { repository } = createRepository();
    const conversation = await repository.createOrGetActiveConversation(1, null, "5511999999999");

    await repository.appendMessage({
      conversationId: conversation!.id,
      userId: 1,
      direction: "inbound",
      externalMessageId: "wamid.later-arrival",
      contentType: "text",
      text: "chegou depois mas é mais antiga",
      occurredAt: new Date("2026-07-10T12:00:00Z"),
    });
    await repository.appendMessage({
      conversationId: conversation!.id,
      userId: 1,
      direction: "inbound",
      externalMessageId: "wamid.earlier-arrival",
      contentType: "text",
      text: "chegou antes mas é mais recente",
      occurredAt: new Date("2026-07-10T13:00:00Z"),
    });

    const messages = await repository.findRecentMessages(conversation!.id);
    expect(messages.map(m => m.sanitizedText)).toEqual([
      "chegou depois mas é mais antiga",
      "chegou antes mas é mais recente",
    ]);
  });

  it("isola mensagens entre usuários diferentes", async () => {
    const { repository } = createRepository();
    const conversationA = await repository.createOrGetActiveConversation(1, null, "5511999999999");
    const conversationB = await repository.createOrGetActiveConversation(2, null, "5511888888888");

    await repository.appendMessage({
      conversationId: conversationA!.id,
      userId: 1,
      direction: "inbound",
      externalMessageId: "wamid.userA",
      contentType: "text",
      text: "mensagem do usuário A",
      occurredAt: new Date("2026-07-10T12:00:00Z"),
    });
    await repository.appendMessage({
      conversationId: conversationB!.id,
      userId: 2,
      direction: "inbound",
      externalMessageId: "wamid.userB",
      contentType: "text",
      text: "mensagem do usuário B",
      occurredAt: new Date("2026-07-10T12:00:00Z"),
    });

    const messagesA = await repository.findRecentMessagesByUser(1);
    const messagesB = await repository.findRecentMessagesByUser(2);

    expect(messagesA).toHaveLength(1);
    expect(messagesA[0].sanitizedText).toBe("mensagem do usuário A");
    expect(messagesB).toHaveLength(1);
    expect(messagesB[0].sanitizedText).toBe("mensagem do usuário B");
  });

  it("recupera o histórico após recriar o repositório contra o mesmo armazenamento subjacente (simula reinício/nova instância)", async () => {
    const db = createFakeDb();
    db.markUnique(whatsappConversationMessages, "idempotencyKey");
    const onWarning = vi.fn();
    const firstInstance = createDrizzleWhatsAppConversationRepository({ getDb: async () => db, onWarning });

    const conversation = await firstInstance.createOrGetActiveConversation(1, null, "5511999999999");
    await firstInstance.appendMessage({
      conversationId: conversation!.id,
      userId: 1,
      direction: "inbound",
      externalMessageId: "wamid.persisted",
      contentType: "text",
      text: "sobrevive ao reinício",
      occurredAt: new Date("2026-07-10T12:00:00Z"),
    });

    const secondInstance = createDrizzleWhatsAppConversationRepository({ getDb: async () => db, onWarning });
    const recovered = await secondInstance.findRecentMessages(conversation!.id);

    expect(recovered).toHaveLength(1);
    expect(recovered[0].sanitizedText).toBe("sobrevive ao reinício");
  });

  it("retorna valores de fallback seguros quando não há banco disponível", async () => {
    const onWarning = vi.fn();
    const repository = createDrizzleWhatsAppConversationRepository({ getDb: async () => null, onWarning });

    await expect(repository.createOrGetActiveConversation(1, null, "5511999999999")).resolves.toBeNull();
    await expect(
      repository.appendMessage({
        conversationId: 1,
        userId: 1,
        direction: "inbound",
        contentType: "text",
        text: "x",
        occurredAt: new Date(),
      }),
    ).resolves.toBeNull();
    await expect(repository.findByIdempotencyKey("whatsapp:inbound:wamid.x")).resolves.toBeNull();
    await expect(repository.findRecentMessages(1)).resolves.toEqual([]);
    await expect(repository.findRecentMessagesByUser(1)).resolves.toEqual([]);
    await expect(repository.findDomainLinksForMessage(1)).resolves.toEqual([]);
    await expect(repository.linkResponse(1, 2)).resolves.toBeUndefined();
    await expect(repository.linkDomainRecord(1, { mealId: 1 })).resolves.toBeUndefined();
    await expect(repository.markProcessed(1)).resolves.toBeUndefined();
  });
});
