import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { MessagesSquare } from "lucide-react";
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";

const originLabels: Record<string, string> = {
  automatic: "Mensagem automática",
  ai_suggested: "Sugestão da IA revisada pelo nutricionista",
  professional: "Enviada pelo nutricionista",
  patient: "Sua resposta",
};
export default function PatientProfessionalMessagesEmbed() {
  const [location] = useLocation();
  const visible = location === "/" || location === "/today";
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!visible) {
      setSlot(null);
      return;
    }
    const update = () => setSlot(document.querySelector("main"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [visible]);
  const query = trpc.professionalRecord.messages.patientList.useQuery(
    { pageSize: 20 },
    { enabled: visible && Boolean(slot), retry: false }
  );
  if (
    !visible ||
    !slot ||
    (!query.isLoading && !query.isError && !query.data?.items.length)
  )
    return null;
  return createPortal(
    <section className="mx-auto mt-6 w-full max-w-6xl px-4 pb-6 sm:px-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessagesSquare className="h-5 w-5" />
            Mensagens do acompanhamento
          </CardTitle>
          <CardDescription>
            Orientações e solicitações registradas no seu acompanhamento.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {query.isLoading && (
            <p role="status" className="text-sm text-muted-foreground">
              Carregando mensagens...
            </p>
          )}
          {query.isError && (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível carregar as mensagens.
            </p>
          )}
          {query.data?.items.map((item: any) => (
            <article key={item.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-medium">
                  {originLabels[item.origin] ?? "Mensagem profissional"}
                </p>
                <span className="text-xs text-muted-foreground">
                  {item.createdAt
                    ? new Date(item.createdAt).toLocaleString("pt-BR")
                    : ""}
                </span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm">{item.content}</p>
              {item.responseCode && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Para responder pelo WhatsApp, inclua o código{" "}
                  <strong>{item.responseCode}</strong>.
                </p>
              )}
            </article>
          ))}
        </CardContent>
      </Card>
    </section>,
    slot
  );
}
