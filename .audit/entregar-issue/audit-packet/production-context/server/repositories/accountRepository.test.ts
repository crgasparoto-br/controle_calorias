import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/mysql-core";
import {
  users,
  whatsappConversationMessages,
  whatsappConversations,
  whatsappConversationSummaries,
  whatsappMessageDomainLinks,
  whatsappPendingOperations,
} from "../../drizzle/schema";

/**
 * Exclusão de conta (issue #767): `purgeUserData` não apaga explicitamente as
 * tabelas do WhatsApp — depende do ON DELETE CASCADE declarado no schema a
 * partir de users.id (ver comentário em accountRepository.ts). Este teste é a
 * garantia estática de que essa dependência continua válida: se uma migration
 * futura remover o cascade de qualquer uma dessas tabelas, este teste falha
 * antes que vire um vazamento de dados em produção.
 */
describe("cascade de exclusão de conta cobre as tabelas do WhatsApp (issue #767)", () => {
  const tablesWithDirectUserFk = [
    { name: "whatsappConversations", table: whatsappConversations },
    { name: "whatsappConversationMessages", table: whatsappConversationMessages },
    { name: "whatsappConversationSummaries", table: whatsappConversationSummaries },
    { name: "whatsappPendingOperations", table: whatsappPendingOperations },
  ];

  it.each(tablesWithDirectUserFk)("$name tem FK para users.id com onDelete cascade", ({ table }) => {
    const config = getTableConfig(table);
    const userFk = config.foreignKeys.find((fk) => {
      const reference = fk.reference();
      return reference.foreignTable === users;
    });

    expect(userFk).toBeDefined();
    expect(userFk?.onDelete).toBe("cascade");
  });

  it("whatsappMessageDomainLinks cascade transitivamente via messageId -> whatsappConversationMessages -> users", () => {
    const config = getTableConfig(whatsappMessageDomainLinks);
    const messageFk = config.foreignKeys.find((fk) => fk.reference().foreignTable === whatsappConversationMessages);

    expect(messageFk).toBeDefined();
    expect(messageFk?.onDelete).toBe("cascade");
  });
});
