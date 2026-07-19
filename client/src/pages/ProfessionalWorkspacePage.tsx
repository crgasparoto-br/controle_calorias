import React from "react";
import ProfessionalLayout from "@/components/ProfessionalLayout";
import PageIntro from "@/components/PageIntro";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useLocation } from "wouter";

const pageContent: Record<string, { title: string; description: string }> = {
  "/professional": {
    title: "Início profissional",
    description:
      "Acompanhe sua operação profissional em um ambiente separado da sua alimentação pessoal.",
  },
  "/professional/patients": {
    title: "Pacientes",
    description:
      "A carteira estruturada será disponibilizada na próxima etapa da evolução profissional.",
  },
  "/professional/follow-up": {
    title: "Acompanhamento",
    description:
      "O prontuário e o ciclo de acompanhamento serão incorporados aqui sem misturar dados pessoais do profissional.",
  },
  "/professional/messages": {
    title: "Mensagens",
    description:
      "A comunicação profissional persistente será centralizada neste espaço.",
  },
  "/professional/reports": {
    title: "Relatórios profissionais",
    description:
      "Os relatórios individuais e da carteira serão adicionados reutilizando os cálculos canônicos.",
  },
  "/professional/settings": {
    title: "Configurações profissionais",
    description:
      "Gerencie identificação e preferências próprias do contexto profissional.",
  },
};

export default function ProfessionalWorkspacePage() {
  const [location] = useLocation();
  const content = pageContent[location] ?? pageContent["/professional"];

  return (
    <ProfessionalLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <PageIntro title={content.title} description={content.description} />
        <Card>
          <CardHeader>
            <CardTitle>Ambiente profissional</CardTitle>
            <CardDescription>
              A navegação já está separada da Área do Paciente. As capacidades
              serão entregues incrementalmente sem remover a página atual.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            Use “Minha alimentação” para voltar à sua experiência pessoal ou
            “Experiência legada” para acessar as funções profissionais já
            existentes.
          </CardContent>
        </Card>
      </div>
    </ProfessionalLayout>
  );
}
