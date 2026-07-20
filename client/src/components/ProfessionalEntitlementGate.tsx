import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, RefreshCw, Settings } from "lucide-react";
import React, { type ReactNode } from "react";
import { useLocation } from "wouter";

export default function ProfessionalEntitlementGate({
  children,
}: {
  children: ReactNode;
}) {
  const [, setLocation] = useLocation();
  const query = trpc.professionalRecord.settings.entitlements.useQuery(
    undefined,
    {
      retry: false,
      refetchOnWindowFocus: true,
      staleTime: 30_000,
    }
  );

  if (query.isLoading) {
    return (
      <div
        role="status"
        className="flex min-h-screen items-center justify-center px-4 text-sm text-muted-foreground"
      >
        Verificando acesso profissional...
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Não foi possível verificar o acesso
            </CardTitle>
            <CardDescription>
              Nenhuma operação profissional foi iniciada. Tente consultar o
              backend novamente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void query.refetch()}>
              <RefreshCw className="h-4 w-4" />
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!query.data?.allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Acesso profissional indisponível</CardTitle>
            <CardDescription>
              O contrato central de acesso não liberou os recursos
              profissionais. Seus pacientes, prontuários e histórico foram
              preservados.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Situação: {query.data?.planName ?? "Elegibilidade indisponível"}
            </p>
            <Button onClick={() => setLocation("/professional/settings")}>
              <Settings className="h-4 w-4" />
              Ver configurações e acesso
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
