import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProfessionalGuidanceHistoryLayout,
  ProfessionalNotesHistoryLayout,
  professionalHistoryExcerpt,
  type ProfessionalGuidanceHistoryItem,
  type ProfessionalNoteHistoryItem,
} from "./ProfessionalRecordHistory";

afterEach(cleanup);

const guidanceItems: ProfessionalGuidanceHistoryItem[] = [
  {
    id: "guidance-1",
    version: 3,
    title: "Café da manhã",
    content:
      "Priorize uma fonte de proteína no café da manhã e mantenha a hidratação ao longo do período. " +
      "Detalhe clínico de leitura integral que só deve aparecer depois da seleção. ".repeat(4),
    visibility: "patient",
    deliveryStatus: "sent",
    authorName: "Nutricionista Ana",
    createdAt: Date.UTC(2026, 8, 3, 12, 0),
  },
  {
    id: "guidance-2",
    version: 1,
    title: "Hidratação",
    content: "Aumente a ingestão de água gradualmente durante o dia.",
    visibility: "patient",
    deliveryStatus: "pending",
    authorName: null,
    createdAt: null,
  },
];

const noteItems: ProfessionalNoteHistoryItem[] = [
  {
    id: "note-1",
    content:
      "Paciente relatou dificuldade com o horário do almoço. Manter observação privada para a próxima revisão. " +
      "Detalhe privado adicional para validar que o seletor compacto não expõe o conteúdo integral antes da seleção. ".repeat(3),
    authorName: "Nutricionista Ana",
    createdAt: Date.UTC(2026, 8, 3, 13, 0),
  },
];

function valueOf(element: HTMLElement) {
  return (element as HTMLTextAreaElement).value;
}

describe("ProfessionalRecordHistory", () => {
  it("creates a real compact excerpt instead of exposing the entire long text in the selector", () => {
    const longText = `Começo ${"conteúdo ".repeat(40)}fim integral`;
    const excerpt = professionalHistoryExcerpt(longText, 40);

    expect(excerpt.length).toBeLessThan(longText.length);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).not.toContain("fim integral");
  });

  it("opens and switches guidance history from the loaded items while preserving the draft", async () => {
    const user = userEvent.setup();
    render(
      <ProfessionalGuidanceHistoryLayout
        items={guidanceItems}
        pagination={<div>Paginação preservada</div>}
      >
        <textarea aria-label="Rascunho da nova orientação" defaultValue="Rascunho mantido" />
      </ProfessionalGuidanceHistoryLayout>
    );

    expect(screen.getByText("Histórico de orientações")).toBeTruthy();
    expect(screen.getByText("Enviada")).toBeTruthy();
    expect(screen.getByText("Paginação preservada")).toBeTruthy();
    expect(
      screen.queryByText(guidanceItems[0].content, { exact: true })
    ).toBeNull();

    const draft = screen.getByRole("textbox", {
      name: "Rascunho da nova orientação",
    });
    await user.type(draft, " + complemento");

    const viewButtons = screen.getAllByRole("button", {
      name: "Visualizar orientação",
    });
    await user.click(viewButtons[0]);

    const firstDetail = screen.getByRole("region", {
      name: "Orientação histórica selecionada",
    });
    expect(firstDetail.textContent).toContain(guidanceItems[0].content);
    expect(screen.getByText("Visível ao paciente")).toBeTruthy();
    expect(valueOf(draft)).toBe("Rascunho mantido + complemento");

    await user.click(viewButtons[1]);
    const secondDetail = screen.getByRole("region", {
      name: "Orientação histórica selecionada",
    });
    expect(secondDetail.textContent).toContain(guidanceItems[1].content);
    expect(within(secondDetail).getByText("Autoria não informada")).toBeTruthy();
    expect(within(secondDetail).getByText("Não informado")).toBeTruthy();
    expect(valueOf(draft)).toBe("Rascunho mantido + complemento");

    await user.click(
      screen.getByRole("button", { name: "Fechar visualização" })
    );
    expect(
      screen.queryByRole("region", { name: "Orientação histórica selecionada" })
    ).toBeNull();
    expect(valueOf(draft)).toBe("Rascunho mantido + complemento");
  });

  it("clears a selected guidance when the authorized payload no longer contains it", async () => {
    const user = userEvent.setup();
    const view = render(
      <ProfessionalGuidanceHistoryLayout items={guidanceItems}>
        <div>Novo registro</div>
      </ProfessionalGuidanceHistoryLayout>
    );

    await user.click(
      screen.getAllByRole("button", { name: "Visualizar orientação" })[0]
    );
    expect(
      screen.getByRole("region", { name: "Orientação histórica selecionada" })
    ).toBeTruthy();

    view.rerender(
      <ProfessionalGuidanceHistoryLayout items={[]}>
        <div>Novo registro</div>
      </ProfessionalGuidanceHistoryLayout>
    );

    expect(
      screen.queryByRole("region", { name: "Orientação histórica selecionada" })
    ).toBeNull();
    expect(screen.getByText("Nenhuma orientação registrada.")).toBeTruthy();
  });

  it("keeps historical notes read-only, private and independent from the new-note draft", async () => {
    const user = userEvent.setup();
    render(
      <ProfessionalNotesHistoryLayout items={noteItems}>
        <textarea aria-label="Rascunho da nova anotação" defaultValue="Observação em edição" />
      </ProfessionalNotesHistoryLayout>
    );

    expect(screen.getByText("Histórico de anotações")).toBeTruthy();
    expect(screen.queryByText(noteItems[0].content, { exact: true })).toBeNull();

    const draft = screen.getByRole("textbox", {
      name: "Rascunho da nova anotação",
    });
    await user.type(draft, " preservada");
    await user.click(
      screen.getByRole("button", { name: "Visualizar anotação" })
    );

    const detail = screen.getByRole("region", {
      name: "Anotação histórica selecionada",
    });
    expect(detail.textContent).toContain(noteItems[0].content);
    expect(detail.textContent).toContain(
      "Conteúdo privado · visível somente ao profissional"
    );
    expect(detail.querySelector("textarea, input")).toBeNull();
    expect(valueOf(draft)).toBe("Observação em edição preservada");
  });
});
