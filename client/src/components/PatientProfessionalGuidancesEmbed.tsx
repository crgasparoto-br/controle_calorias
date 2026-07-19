import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { MessageSquareText } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";

type Guidance = {
  id: string;
  version: number;
  title: string;
  content: string;
  deliveryStatus: string;
  professionalName: string;
  createdAt: number | null;
};

export default function PatientProfessionalGuidancesEmbed() {
  const [location] = useLocation();
  const shouldRender = location === "/" || location === "/today";
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!shouldRender) {
      setSlot(null);
      return;
    }
    const update = () => setSlot(document.querySelector("main"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [shouldRender]);

  const procedure = (trpc as typeof trpc & {
    professionalRecord?: {
      patientGuidances?: {
        useQuery?: (
          input: undefined,
          options: { enabled: boolean; retry: boolean }
        ) => {
          data?: Guidance[];
          isLoading: boolean;
          isError: boolean;
        };
      };
    };
  }).professionalRecord?.patientGuidances;
  const query = procedure?.useQuery?.(undefined, {
    enabled: shouldRender && Boolean(slot),
    retry: false,
  }) ?? { data: [] as Guidance[], isLoading: false, isError: false };

  if (!shouldRender || !slot) return null;
  const guidances = query.data ?? [];
  return createPortal(
    <section className="mx-auto mt-6 w-full max-w-6xl px-4 pb-6 sm:px-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MessageSquareText className="h-5 w-5" />Orientações do acompanhamento</CardTitle>
          <CardDescription>Orientações registradas pelo profissional responsável pelo seu acompanhamento.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {query.isLoading && <p role="status" className="text-sm text-muted-foreground">Carregando orientações...</p>}
          {query.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar as orientações.</p>}
          {!query.isLoading && !query.isError && guidances.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma orientação disponível.</p>}
          {guidances.map(item => <article key={item.id} className="rounded-xl border bg-muted/10 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{item.title}</h3><span className="text-xs text-muted-foreground">{item.createdAt ? new Date(item.createdAt).toLocaleString("pt-BR") : "Sem data"}</span></div><p className="mt-1 text-xs text-muted-foreground">{item.professionalName} · versão {item.version} · entrega {item.deliveryStatus}</p><p className="mt-3 whitespace-pre-wrap text-sm leading-6">{item.content}</p></article>)}
        </CardContent>
      </Card>
    </section>,
    slot
  );
}
