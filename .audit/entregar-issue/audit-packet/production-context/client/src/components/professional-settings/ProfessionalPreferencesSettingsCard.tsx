import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Save, Trash2 } from "lucide-react";
import React from "react";

export type MessageType =
  | "guidance"
  | "reminder"
  | "weigh_in_request"
  | "record_request"
  | "administrative"
  | "follow_up_summary";
export type TemplateDraft = {
  id?: string;
  title: string;
  messageType: MessageType;
  content: string;
};

type Props = {
  defaultReviewIntervalDays: string;
  messageTemplates: TemplateDraft[];
  saving: boolean;
  onDefaultReviewIntervalDaysChange: (value: string) => void;
  onMessageTemplatesChange: (value: TemplateDraft[]) => void;
  onSave: () => void;
};

const messageTypeLabels: Record<MessageType, string> = {
  guidance: "Orientação",
  reminder: "Lembrete",
  weigh_in_request: "Solicitação de pesagem",
  record_request: "Solicitação de registro",
  administrative: "Administrativa",
  follow_up_summary: "Resumo de acompanhamento",
};

export default function ProfessionalPreferencesSettingsCard({
  defaultReviewIntervalDays,
  messageTemplates,
  saving,
  onDefaultReviewIntervalDaysChange,
  onMessageTemplatesChange,
  onSave,
}: Props) {
  const updateTemplate = (index: number, patch: Partial<TemplateDraft>) => {
    onMessageTemplatesChange(
      messageTemplates.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      )
    );
  };

  const hasInvalidTemplate = messageTemplates.some(
    template => !template.title.trim() || !template.content.trim()
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferências operacionais</CardTitle>
        <CardDescription>
          Somente padrões já consumidos pelos fluxos profissionais podem ser
          alterados aqui. Lembretes são definidos por paciente na central de
          acompanhamento; resumos automáticos ainda não estão habilitados.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <label className="grid max-w-sm gap-1 text-sm">
          <span className="font-medium">Revisão padrão (dias)</span>
          <Input
            type="number"
            min={1}
            max={365}
            value={defaultReviewIntervalDays}
            onChange={event =>
              onDefaultReviewIntervalDaysChange(event.target.value)
            }
            placeholder="Sem padrão"
          />
          <span className="text-xs text-muted-foreground">
            Aplicada somente a novas avaliações sem data explícita de revisão.
          </span>
        </label>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Modelos de mensagem</h3>
              <p className="text-sm text-muted-foreground">
                Os modelos apenas preenchem um rascunho e nunca são enviados
                automaticamente.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={messageTemplates.length >= 20}
              onClick={() =>
                onMessageTemplatesChange([
                  ...messageTemplates,
                  { title: "", messageType: "reminder", content: "" },
                ])
              }
            >
              Adicionar modelo
            </Button>
          </div>

          {messageTemplates.length === 0 ? (
            <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              Nenhum modelo cadastrado.
            </p>
          ) : (
            <div className="grid gap-3">
              {messageTemplates.map((template, index) => (
                <div
                  key={template.id ?? `new-${index}`}
                  className="grid gap-3 rounded-xl border p-4"
                >
                  <div className="grid gap-3 md:grid-cols-[1fr_240px_auto]">
                    <Input
                      aria-label={`Título do modelo ${index + 1}`}
                      placeholder="Título do modelo"
                      value={template.title}
                      onChange={event =>
                        updateTemplate(index, { title: event.target.value })
                      }
                    />
                    <select
                      aria-label={`Tipo do modelo ${index + 1}`}
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                      value={template.messageType}
                      onChange={event =>
                        updateTemplate(index, {
                          messageType: event.target.value as MessageType,
                        })
                      }
                    >
                      {Object.entries(messageTypeLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Remover modelo ${index + 1}`}
                      onClick={() =>
                        onMessageTemplatesChange(
                          messageTemplates.filter(
                            (_, itemIndex) => itemIndex !== index
                          )
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <textarea
                    aria-label={`Conteúdo do modelo ${index + 1}`}
                    className="min-h-24 rounded-md border bg-background p-3 text-sm"
                    placeholder="Conteúdo do rascunho"
                    value={template.content}
                    onChange={event =>
                      updateTemplate(index, { content: event.target.value })
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <Button
          className="w-fit"
          disabled={saving || hasInvalidTemplate}
          onClick={onSave}
        >
          <Save className="h-4 w-4" />
          {saving ? "Salvando preferências..." : "Salvar preferências"}
        </Button>
      </CardContent>
    </Card>
  );
}
