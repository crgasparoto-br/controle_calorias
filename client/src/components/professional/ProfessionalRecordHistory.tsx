import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Eye, LockKeyhole, X } from "lucide-react";
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { ProfessionalSplitLayout, ProfessionalStatusBadge } from "./ProfessionalUi";

export type ProfessionalGuidanceHistoryItem = {
  id: string;
  version: number;
  title: string;
  content: string;
  visibility?: string | null;
  deliveryStatus?: string | null;
  authorName?: string | null;
  supersedesGuidanceId?: string | null;
  createdAt?: number | null;
};

export type ProfessionalNoteHistoryItem = {
  id: string;
  content: string;
  authorName?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
};

function formatDate(value: number | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "Não informado";
}

function authorLabel(value: string | null | undefined) {
  return value?.trim() || "Autoria não informada";
}

export function professionalHistoryExcerpt(value: string, limit = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit).trimEnd()}…`;
}

function HistoryLayout({
  aside,
  children,
  detail,
}: {
  aside: ReactNode;
  children: ReactNode;
  detail: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-6">
      <ProfessionalSplitLayout aside={aside}>{children}</ProfessionalSplitLayout>
      {detail}
    </div>
  );
}

function SelectorPagination({ children }: { children?: ReactNode }) {
  return children ? <div className="pt-1">{children}</div> : null;
}

export function ProfessionalGuidanceHistoryLayout({
  children,
  items,
  pagination,
}: {
  children: ReactNode;
  items: ProfessionalGuidanceHistoryItem[];
  pagination?: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const selected = items.find(item => item.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selected, selectedId]);

  const open = (id: string) => {
    setSelectedId(id);
    window.requestAnimationFrame(() => detailRef.current?.focus());
  };

  const close = () => {
    const id = selectedId;
    setSelectedId(null);
    if (id) {
      window.requestAnimationFrame(() => triggerRefs.current.get(id)?.focus());
    }
  };

  return (
    <HistoryLayout
      aside={
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Histórico de orientações</CardTitle>
            <CardDescription>
              Selecione um registro para ler o conteúdo completo sem sair da nova orientação.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1">
              {items.length ? (
                items.map(item => (
                  <article key={item.id} className="rounded-xl border p-3">
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 break-words font-medium">
                        {item.title || "Orientação sem título"} · v{item.version}
                      </p>
                      <ProfessionalStatusBadge
                        kind="message"
                        value={item.deliveryStatus}
                      />
                    </div>
                    <p className="mt-2 line-clamp-3 break-words text-sm text-muted-foreground">
                      {professionalHistoryExcerpt(item.content)}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {authorLabel(item.authorName)} · {formatDate(item.createdAt)}
                    </p>
                    <Button
                      ref={element => {
                        if (element) triggerRefs.current.set(item.id, element);
                        else triggerRefs.current.delete(item.id);
                      }}
                      type="button"
                      variant="outline"
                      className="mt-3 w-full sm:w-auto"
                      aria-expanded={selectedId === item.id}
                      aria-controls="professional-guidance-history-detail"
                      onClick={() => open(item.id)}
                    >
                      <Eye className="h-4 w-4" aria-hidden="true" />
                      Visualizar orientação
                    </Button>
                  </article>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhuma orientação registrada.
                </p>
              )}
            </div>
            <SelectorPagination>{pagination}</SelectorPagination>
          </CardContent>
        </Card>
      }
      detail={
        selected ? (
          <section
            id="professional-guidance-history-detail"
            ref={detailRef}
            tabIndex={-1}
            aria-label="Orientação histórica selecionada"
            className="min-w-0 scroll-mt-24 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Card>
              <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <CardTitle className="break-words">
                    {selected.title || "Orientação sem título"} · v{selected.version}
                  </CardTitle>
                  <CardDescription className="mt-2 flex flex-wrap items-center gap-2">
                    <span>{authorLabel(selected.authorName)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDate(selected.createdAt)}</span>
                    <span aria-hidden="true">·</span>
                    <span>Entrega</span>
                    <ProfessionalStatusBadge
                      kind="message"
                      value={selected.deliveryStatus}
                    />
                    {selected.visibility === "patient" ? (
                      <span>Visível ao paciente</span>
                    ) : null}
                  </CardDescription>
                </div>
                <Button type="button" variant="outline" onClick={close}>
                  <X className="h-4 w-4" aria-hidden="true" />
                  Fechar visualização
                </Button>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap break-words text-sm leading-7">
                  {selected.content}
                </p>
              </CardContent>
            </Card>
          </section>
        ) : null
      }
    >
      {children}
    </HistoryLayout>
  );
}

export function ProfessionalNotesHistoryLayout({
  children,
  items,
  pagination,
}: {
  children: ReactNode;
  items: ProfessionalNoteHistoryItem[];
  pagination?: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const selected = items.find(item => item.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selected, selectedId]);

  const open = (id: string) => {
    setSelectedId(id);
    window.requestAnimationFrame(() => detailRef.current?.focus());
  };

  const close = () => {
    const id = selectedId;
    setSelectedId(null);
    if (id) {
      window.requestAnimationFrame(() => triggerRefs.current.get(id)?.focus());
    }
  };

  return (
    <HistoryLayout
      aside={
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Histórico de anotações</CardTitle>
            <CardDescription>
              Consulte registros privados anteriores sem alterar o rascunho atual.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1">
              {items.length ? (
                items.map(item => (
                  <article key={item.id} className="rounded-xl border p-3">
                    <p className="text-xs text-muted-foreground">
                      {authorLabel(item.authorName)} · {formatDate(item.createdAt)}
                    </p>
                    <p className="mt-2 line-clamp-3 break-words text-sm text-muted-foreground">
                      {professionalHistoryExcerpt(item.content, 160)}
                    </p>
                    <Button
                      ref={element => {
                        if (element) triggerRefs.current.set(item.id, element);
                        else triggerRefs.current.delete(item.id);
                      }}
                      type="button"
                      variant="outline"
                      className="mt-3 w-full sm:w-auto"
                      aria-expanded={selectedId === item.id}
                      aria-controls="professional-note-history-detail"
                      onClick={() => open(item.id)}
                    >
                      <Eye className="h-4 w-4" aria-hidden="true" />
                      Visualizar anotação
                    </Button>
                  </article>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhuma anotação registrada.
                </p>
              )}
            </div>
            <SelectorPagination>{pagination}</SelectorPagination>
          </CardContent>
        </Card>
      }
      detail={
        selected ? (
          <section
            id="professional-note-history-detail"
            ref={detailRef}
            tabIndex={-1}
            aria-label="Anotação histórica selecionada"
            className="min-w-0 scroll-mt-24 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Card>
              <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <CardTitle>Anotação privada</CardTitle>
                  <CardDescription className="mt-2 flex flex-wrap items-center gap-2">
                    <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                    <span>Conteúdo privado · visível somente ao profissional</span>
                    <span aria-hidden="true">·</span>
                    <span>{authorLabel(selected.authorName)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDate(selected.createdAt)}</span>
                  </CardDescription>
                </div>
                <Button type="button" variant="outline" onClick={close}>
                  <X className="h-4 w-4" aria-hidden="true" />
                  Fechar visualização
                </Button>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap break-words text-sm leading-7">
                  {selected.content}
                </p>
              </CardContent>
            </Card>
          </section>
        ) : null
      }
    >
      {children}
    </HistoryLayout>
  );
}
