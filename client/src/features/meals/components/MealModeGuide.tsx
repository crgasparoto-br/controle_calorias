import React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrainCircuit, CalendarDays, ImagePlus, PencilLine, WandSparkles } from "lucide-react";

type MealMode = "ia" | "foto" | "manual" | "hoje";

type MealModeGuideProps = {
  activeMode: MealMode;
  onModeChange: (mode: MealMode) => void;
};

const modeCards = [
  {
    value: "ia" as const,
    title: "IA multimodal",
    description: "Junte texto, imagem e áudio no mesmo fluxo quando quiser montar uma refeição com mais contexto.",
    icon: WandSparkles,
  },
  {
    value: "foto" as const,
    title: "Foto",
    description: "Use quando a imagem do prato já basta e você quer corrigir só porções e itens sugeridos.",
    icon: ImagePlus,
  },
  {
    value: "manual" as const,
    title: "Manual",
    description: "Ideal para criar ou editar refeições rapidamente, com mais controle sobre horários e alimentos.",
    icon: PencilLine,
  },
  {
    value: "hoje" as const,
    title: "Revisão do dia",
    description: "Abra os registros recentes para revisar, copiar, favoritar ou retomar uma edição sem rolar a página inteira.",
    icon: CalendarDays,
  },
];

export function MealModeGuide({ activeMode, onModeChange }: MealModeGuideProps) {
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {modeCards.map(mode => {
        const Icon = mode.icon;
        const isActive = activeMode === mode.value;

        return (
          <div
            key={mode.value}
            className={cn(
              "rounded-3xl border p-4 shadow-sm transition-colors",
              isActive ? "border-primary/40 bg-primary/5" : "bg-card",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-background shadow-sm ring-1 ring-border/70">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium tracking-tight">{mode.title}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{mode.description}</p>
                </div>
              </div>
              {mode.value === "ia" ? <BrainCircuit className="mt-1 h-4 w-4 text-muted-foreground" /> : null}
            </div>
            <Button
              type="button"
              variant={isActive ? "default" : "outline"}
              className="mt-4 h-10 rounded-full px-4"
              onClick={() => onModeChange(mode.value)}
            >
              {isActive ? "Modo ativo" : "Abrir modo"}
            </Button>
          </div>
        );
      })}
    </section>
  );
}
