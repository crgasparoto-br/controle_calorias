import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findWhatsAppResponseArchitectureViolations,
  findWhatsAppResponseArchitectureViolationsWithAllowlist,
  WHATSAPP_RESPONSE_ARCHITECTURE_ALLOWLIST,
  type WhatsAppArchitectureFile,
} from "../../../scripts/whatsapp-response-architecture";

const root = path.resolve(import.meta.dirname, "../../..");

function readReal(relativePath: string): WhatsAppArchitectureFile {
  return { path: relativePath, content: readFileSync(path.join(root, relativePath), "utf8") };
}

describe("guard arquitetural do contrato de respostas (issue #788)", () => {
  describe("fixtures positivas: cada classe de violação é bloqueada", () => {
    it("bloqueia chamada direta à Cloud API fora do transporte", () => {
      const violations = findWhatsAppResponseArchitectureViolations([
        {
          path: "server/modules/meals/rogue.ts",
          content: `await fetch("https://graph.facebook.com/v22.0/123/messages", { method: "POST" });`,
        },
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("graph.facebook.com");
    });

    it("bloqueia montagem de payload bruto da Cloud API em handler", () => {
      const violations = findWhatsAppResponseArchitectureViolations([
        {
          path: "server/modules/whatsapp/rogueHandler.ts",
          content: `const payload = { messaging_product: "whatsapp", to, type: "text", text: { body } };`,
        },
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("messaging_product");
    });

    it("bloqueia import de função de envio fora do transporte autorizado", () => {
      const violations = findWhatsAppResponseArchitectureViolations([
        {
          path: "server/modules/whatsapp/rogueSender.ts",
          content: `import { sendWhatsAppTextMessage } from "./webhookUtils";`,
        },
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("sendWhatsAppTextMessage");
    });

    it("bloqueia import de envio com caminho relativo profundo e alias", () => {
      const violations = findWhatsAppResponseArchitectureViolations([
        {
          path: "server/modules/onboarding/rogue.ts",
          content: `import { sendWhatsAppInteractiveButtonsMessage as sendButtons } from "../whatsapp/webhookUtils";`,
        },
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("sendWhatsAppInteractiveButtonsMessage");
    });

    it("bloqueia rótulo legado de meta em outbound final", () => {
      const violations = findWhatsAppResponseArchitectureViolations([
        {
          path: "server/modules/whatsapp/rogueFormatter.ts",
          content: `const line = \`*Meta estimada:* \${goal} kcal\`;`,
        },
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("Meta estimada");
    });

    it("bloqueia fluxo WhatsApp que recalcula a regra de meta da #756", () => {
      const violations = findWhatsAppResponseArchitectureViolations([
        {
          path: "server/modules/whatsapp/rogueGoal.ts",
          content: `const goal = calculateAdjustedGoalCalories(base, burned, include);`,
        },
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("calculateAdjustedGoalCalories");
    });

    it("permite a regra de meta nos domínios fora do WhatsApp", () => {
      const violations = findWhatsAppResponseArchitectureViolations([
        {
          path: "server/modules/goals/service.ts",
          content: `const goal = calculateAdjustedGoalCalories(base, burned, include);`,
        },
      ]);
      expect(violations).toHaveLength(0);
    });

    it("bloqueia schema de ação estruturada que aceita texto final da IA", () => {
      const violations = findWhatsAppResponseArchitectureViolations([
        {
          path: "server/modules/whatsapp/rogueSchema.ts",
          content: `const schema = z.object({ intent: z.string(), finalText: z.string() });`,
        },
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("texto final");
    });
  });

  describe("fixtures negativas: casos permitidos não geram falso positivo", () => {
    it("não varre arquivos de teste, fixtures ou declarações", () => {
      const files: WhatsAppArchitectureFile[] = [
        { path: "server/modules/whatsapp/foo.test.ts", content: `fetch("https://graph.facebook.com/x/messages")` },
        { path: "server/modules/whatsapp/__fixtures__/payload.ts", content: `{ messaging_product: "whatsapp" }` },
        { path: "server/types.d.ts", content: `// Meta estimada` },
      ];
      expect(findWhatsAppResponseArchitectureViolations(files)).toHaveLength(0);
    });

    it("permite download de mídia e read receipt fora do transporte", () => {
      const violations = findWhatsAppResponseArchitectureViolations([
        {
          path: "server/modules/whatsapp/webhookMediaPipeline.ts",
          content: `import { downloadWhatsAppMedia, markWhatsAppMessageAsRead } from "./webhookUtils";`,
        },
      ]);
      expect(violations).toHaveLength(0);
    });

    it("permite parâmetro chamado finalText que não é schema de IA", () => {
      const violations = findWhatsAppResponseArchitectureViolations([
        {
          path: "server/modules/whatsapp/compose.ts",
          content: `export function compose(finalText: string) { return finalText; }`,
        },
      ]);
      expect(violations).toHaveLength(0);
    });

    it("permite os módulos autorizados reais do repositório", () => {
      const files = [
        readReal("server/modules/whatsapp/webhookUtils.ts"),
        readReal("server/modules/whatsapp/replyTransport.ts"),
        readReal("server/modules/whatsapp/processingAcknowledgementDelivery.ts"),
      ];
      expect(findWhatsAppResponseArchitectureViolations(files)).toHaveLength(0);
    });
  });

  describe("allowlist mínima e justificada", () => {
    it("toda entrada tem motivo não vazio e aponta para arquivo existente", () => {
      for (const entry of WHATSAPP_RESPONSE_ARCHITECTURE_ALLOWLIST) {
        expect(entry.reason.trim().length, `motivo vazio para ${entry.path}`).toBeGreaterThan(0);
        expect(() => readReal(entry.path), `arquivo inexistente na allowlist: ${entry.path}`).not.toThrow();
      }
    });

    it("toda entrada é necessária: sem ela o arquivo real viola a regra correspondente", () => {
      for (const entry of WHATSAPP_RESPONSE_ARCHITECTURE_ALLOWLIST) {
        const withoutEntry = WHATSAPP_RESPONSE_ARCHITECTURE_ALLOWLIST.filter(other => other !== entry);
        const violations = findWhatsAppResponseArchitectureViolationsWithAllowlist(
          [readReal(entry.path)],
          withoutEntry,
        );
        expect(
          violations.length,
          `entrada desnecessária na allowlist: ${entry.path} / ${entry.rule}`,
        ).toBeGreaterThan(0);
      }
    });

    it("entrada sem justificativa deixa de autorizar o arquivo", () => {
      const unjustified = WHATSAPP_RESPONSE_ARCHITECTURE_ALLOWLIST.map(entry => ({ ...entry, reason: " " }));
      const violations = findWhatsAppResponseArchitectureViolationsWithAllowlist(
        [readReal("server/modules/whatsapp/webhookUtils.ts")],
        unjustified,
      );
      expect(violations.length).toBeGreaterThan(0);
    });
  });

  it("o código de produção atual do servidor não possui violações", () => {
    // Espelha a varredura feita por scripts/check-architecture.ts.
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const files: WhatsAppArchitectureFile[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(path.join(root, dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
        else if (rel.endsWith(".ts")) files.push(readReal(rel));
      }
    };
    walk("server");
    expect(findWhatsAppResponseArchitectureViolations(files)).toEqual([]);
  });
});
