import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Link } from "wouter";
import AuthShell from "@/components/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = trpc.auth.login.useMutation({
    onSuccess: async () => {
      setError(null);
      await utils.auth.me.invalidate();
      window.location.href = "/";
    },
    onError: error => {
      setError(error.message || "E-mail ou senha inválidos.");
    },
  });

  return (
    <AuthShell
      eyebrow="Acesso"
      title="Entre e retome sua rotina nutricional"
      description="Acompanhe refeições, metas e relatórios em um fluxo mais claro desde a primeira tela. A autenticação continua igual, com um ponto de entrada mais organizado e confortável de usar."
      formTitle="Entrar"
      formDescription="Acesse sua conta com e-mail e senha."
      metrics={[
        { label: "Registros", value: "refeições, metas e relatórios" },
        { label: "Acesso", value: "rápido no desktop e no mobile" },
        { label: "Fluxo", value: "entrada direta na área principal" },
      ]}
      footer={<>Ainda não tem conta? <Link className="font-medium text-primary" href="/register">Cadastre-se</Link></>}
    >
      <form
        className="space-y-5"
        onSubmit={event => {
          event.preventDefault();
          setError(null);
          login.mutate({ email, password });
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="login-email">E-mail</Label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="login-password">Senha</Label>
          <div className="relative">
            <Input
              id="login-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              className="pr-11"
              required
            />
            <button
              type="button"
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setShowPassword(current => !current)}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button className="h-11 w-full" disabled={login.isPending} type="submit">
          {login.isPending ? "Entrando..." : "Entrar"}
        </Button>
      </form>
    </AuthShell>
  );
}
