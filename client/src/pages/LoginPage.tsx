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
  const [showForgotPasswordHelp, setShowForgotPasswordHelp] = useState(false);
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
      title="Entre"
      description="Acesse sua conta com e-mail e senha."
      formTitle="Entrar"
      formDescription="Acesse sua conta com e-mail e senha."
      metrics={[]}
      hideHero
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
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="login-password">Senha</Label>
            <button
              type="button"
              className="text-sm font-medium text-primary transition-colors hover:text-primary/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={showForgotPasswordHelp}
              aria-controls="forgot-password-help"
              onClick={() => setShowForgotPasswordHelp(current => !current)}
            >
              Esqueceu a senha?
            </button>
          </div>
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
          {showForgotPasswordHelp ? (
            <p id="forgot-password-help" className="text-sm leading-6 text-muted-foreground">
              A recuperação automática de senha ainda não está disponível. Se precisar recuperar o acesso, peça a redefinição para quem administra o app.
            </p>
          ) : null}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button className="h-11 w-full" disabled={login.isPending} type="submit">
          {login.isPending ? "Entrando..." : "Entrar"}
        </Button>
      </form>
    </AuthShell>
  );
}
