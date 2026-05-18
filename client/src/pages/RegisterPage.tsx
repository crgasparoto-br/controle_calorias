import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function RegisterPage() {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const register = trpc.auth.register.useMutation({
    onSuccess: async () => {
      setError(null);
      await utils.auth.me.invalidate();
      window.location.href = "/";
    },
    onError: error => {
      setError(error.message || "Não foi possível criar a conta.");
    },
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-10">
      <section className="w-full max-w-md rounded-3xl border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Criar conta</h1>
          <p className="text-sm text-muted-foreground">Cadastre nome, e-mail e senha para iniciar sua jornada nutricional.</p>
        </div>
        <form
          className="mt-8 space-y-5"
          onSubmit={event => {
            event.preventDefault();
            setError(null);
            register.mutate({ name, email, password });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="register-name">Nome</Label>
            <Input
              id="register-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={event => setName(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="register-email">E-mail</Label>
            <Input
              id="register-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="register-password">Senha</Label>
            <Input
              id="register-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button className="h-11 w-full" disabled={register.isPending} type="submit">
            {register.isPending ? "Criando..." : "Criar conta"}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Já tem conta? <Link className="font-medium text-primary" href="/login">Entrar</Link>
        </p>
      </section>
    </main>
  );
}
