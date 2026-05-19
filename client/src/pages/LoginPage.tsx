import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-10">
      <section className="w-full max-w-md rounded-3xl border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
          <p className="text-sm text-muted-foreground">Acesse sua conta com e-mail e senha.</p>
        </div>
        <form
          className="mt-8 space-y-5"
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
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button className="h-11 w-full" disabled={login.isPending} type="submit">
            {login.isPending ? "Entrando..." : "Entrar"}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Ainda não tem conta? <Link className="font-medium text-primary" href="/register">Cadastre-se</Link>
        </p>
      </section>
    </main>
  );
}
