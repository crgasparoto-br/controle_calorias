import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Home, Search } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,rgba(245,247,250,0.98)_0%,rgba(236,242,247,0.95)_100%)] px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-6xl items-stretch gap-6 lg:grid-cols-[1.1fr,0.9fr]">
        <section className="overflow-hidden rounded-[32px] border border-border/70 bg-card px-6 py-8 shadow-sm sm:px-8 sm:py-10 lg:px-10 lg:py-12">
          <div className="max-w-xl space-y-5">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Navegação</p>
              <div className="space-y-3">
                <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">Essa página não foi encontrada</h1>
                <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                  O endereço pode estar desatualizado, ter sido movido ou talvez a navegação tenha chegado a uma rota que já não existe mais.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <IntroStat label="Status" value="404" supporting="rota indisponível" />
              <IntroStat label="Ação sugerida" value="voltar ao início" supporting="retomar o fluxo principal" />
              <IntroStat label="Experiência" value="mais clara" supporting="mesmo padrão visual do app" />
            </div>

            <div className="rounded-[28px] border border-border/70 bg-background/80 p-5 shadow-sm sm:p-6">
              <div className="flex items-start gap-3">
                <Search className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">Siga pelo caminho principal</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Voltar para a página inicial costuma resolver rapidamente quando a rota foi digitada manualmente ou aberta a partir de um link antigo.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <Card className="border-border/70 bg-card/95 py-0 shadow-sm backdrop-blur-sm">
          <CardContent className="flex h-full flex-col justify-center p-6 text-center sm:p-8">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-rose-50 text-rose-600">
              <AlertCircle className="h-10 w-10" />
            </div>

            <div className="mt-6 space-y-2">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">Erro de navegação</p>
              <h2 className="text-3xl font-semibold tracking-tight text-foreground">404</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                A página que você tentou abrir não está disponível neste momento.
              </p>
            </div>

            <div className="mt-8 flex flex-col gap-3">
              <Button onClick={handleGoHome} className="h-11 w-full rounded-full">
                <Home className="mr-2 h-4 w-4" />
                Ir para a página inicial
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function IntroStat({ label, value, supporting }: { label: string; value: string; supporting: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-4 text-left">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{supporting}</p>
    </div>
  );
}
