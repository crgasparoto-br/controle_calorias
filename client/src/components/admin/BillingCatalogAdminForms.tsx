import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import React from "react";

export type ProductForm = { code: string; name: string; audience: "individual" | "professional"; reason: string };
export type VersionForm = { productCode: string; name: string; cycle: "monthly" | "yearly"; price: string; capacity: string; resources: string; beneficiaryResources: string; reason: string };
export type CouponForm = { code: string; percent: string; duration: string; cycles: string; products: string; reason: string };

const RESOURCE_CODES: Record<string, string> = {
  "acesso ao sistema": "system_access",
  "acesso pela web": "web_access",
  "registro pelo whatsapp": "whatsapp_access",
  "refeições por texto": "meal_text",
  "refeicoes por texto": "meal_text",
  "refeições por imagem": "meal_image",
  "refeicoes por imagem": "meal_image",
  "refeições por áudio": "meal_audio",
  "refeicoes por audio": "meal_audio",
  "assistência por ia": "ai_assistance",
  "assistencia por ia": "ai_assistance",
  "metas nutricionais": "nutrition_goals",
  "relatórios": "reports",
  "relatorios": "reports",
  "acompanhamento de peso": "weight_tracking",
  "acompanhamento de água": "water_tracking",
  "acompanhamento de agua": "water_tracking",
  "acompanhamento de exercícios": "exercise_tracking",
  "acompanhamento de exercicios": "exercise_tracking",
  "integrações de saúde": "health_integrations",
  "integracoes de saude": "health_integrations",
  "painel profissional": "professional_dashboard",
  "carteira de pacientes": "professional_portfolio",
  "prontuário profissional": "professional_record",
  "prontuario profissional": "professional_record",
  "metas dos pacientes": "professional_goals",
  "alertas operacionais": "professional_operational_alerts",
  "mensagens profissionais": "professional_messages",
  "relatórios profissionais": "professional_reports",
  "relatorios profissionais": "professional_reports",
  "assistência por ia profissional": "professional_ai_assistance",
  "assistencia por ia profissional": "professional_ai_assistance",
  "configurações profissionais": "professional_settings",
  "configuracoes profissionais": "professional_settings",
};

export const initialProduct: ProductForm = { code: "", name: "", audience: "individual", reason: "" };
export const initialVersion: VersionForm = { productCode: "", name: "", cycle: "monthly", price: "", capacity: "", resources: "Acesso ao sistema, Acesso pela web, Registro pelo WhatsApp", beneficiaryResources: "", reason: "" };
export const initialCoupon: CouponForm = { code: "", percent: "10", duration: "1", cycles: "monthly", products: "", reason: "" };
export const splitCsv = (value: string) => value.split(",").map(item => item.trim()).filter(Boolean);
export const splitResources = (value: string) => splitCsv(value).map(item => RESOURCE_CODES[item.toLowerCase()] ?? item);

type FormProps<T> = { form: T; setForm: React.Dispatch<React.SetStateAction<T>>; pending: boolean; mutationError?: string; onSubmit: () => void };

export function Field({ label, id, value, onChange, error, textarea = false, optional = false }: { label: string; id: string; value: string; onChange: (value: string) => void; error?: string | null; textarea?: boolean; optional?: boolean }) {
  const errorId = `${id}-error`;
  const props = { id, value, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value), "aria-invalid": Boolean(error), "aria-describedby": error ? errorId : undefined };
  return <div className="space-y-2"><Label htmlFor={id}>{label}{optional ? " (opcional)" : ""}</Label>{textarea ? <Textarea {...props} /> : <Input {...props} />}{error ? <p id={errorId} role="alert" className="text-xs text-destructive">{error}</p> : null}</div>;
}

function MutationError({ message }: { message?: string }) {
  return message ? <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{message}</p> : null;
}

export function ProductDialog({ form, setForm, pending, mutationError, onSubmit }: FormProps<ProductForm>) {
  const update = <K extends keyof ProductForm>(key: K, value: ProductForm[K]) => setForm(current => ({ ...current, [key]: value }));
  const errors = { code: form.code.trim().length < 2 ? "Informe um código com pelo menos 2 caracteres." : null, name: form.name.trim().length < 2 ? "Informe um nome com pelo menos 2 caracteres." : null, reason: form.reason.trim().length < 3 ? "Informe um motivo com pelo menos 3 caracteres." : null };
  return <><DialogHeader><DialogTitle>Novo produto</DialogTitle><DialogDescription>Crie uma família de produto sem alterar contratos existentes.</DialogDescription></DialogHeader><div className="space-y-4"><Field label="Código" id="product-code" value={form.code} onChange={value => update("code", value)} error={errors.code} /><Field label="Nome" id="product-name" value={form.name} onChange={value => update("name", value)} error={errors.name} /><div className="space-y-2"><Label htmlFor="product-audience">Público</Label><select id="product-audience" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.audience} onChange={event => update("audience", event.target.value as ProductForm["audience"])}><option value="individual">Individual</option><option value="professional">Profissional</option></select></div><Field label="Motivo" id="product-reason" value={form.reason} onChange={value => update("reason", value)} error={errors.reason} textarea /><MutationError message={mutationError} /><Button className="w-full sm:w-auto" disabled={pending || Object.values(errors).some(Boolean)} onClick={onSubmit}>{pending ? "Criando produto..." : "Criar produto"}</Button></div></>;
}

export function VersionDialog({ form, setForm, pending, mutationError, onSubmit }: FormProps<VersionForm>) {
  const update = <K extends keyof VersionForm>(key: K, value: VersionForm[K]) => setForm(current => ({ ...current, [key]: value }));
  const price = Math.round(Number(form.price.replace(",", ".")) * 100); const capacity = form.capacity.trim() ? Number(form.capacity) : null;
  const errors = { product: !form.productCode.trim() ? "Informe a família do produto." : null, name: !form.name.trim() ? "Informe o nome da versão." : null, price: !Number.isInteger(price) || price <= 0 ? "Informe um preço maior que zero." : null, capacity: capacity !== null && (!Number.isInteger(capacity) || capacity <= 0) ? "Use um número inteiro maior que zero ou deixe vazio." : null, resources: !splitResources(form.resources).length ? "Informe ao menos um recurso incluído." : null, reason: form.reason.trim().length < 3 ? "Informe um motivo com pelo menos 3 caracteres." : null };
  return <><DialogHeader><DialogTitle>Nova versão</DialogTitle><DialogDescription>Defina preço, capacidade e recursos da nova versão comercial.</DialogDescription></DialogHeader><div className="space-y-4"><Field label="Produto" id="version-product" value={form.productCode} onChange={value => update("productCode", value)} error={errors.product} /><Field label="Nome da versão" id="version-name" value={form.name} onChange={value => update("name", value)} error={errors.name} /><div className="grid gap-4 sm:grid-cols-2"><Field label="Preço (R$)" id="version-price" value={form.price} onChange={value => update("price", value)} error={errors.price} /><Field label="Capacidade" id="version-capacity" value={form.capacity} onChange={value => update("capacity", value)} error={errors.capacity} optional /></div><Field label="Recursos incluídos" id="version-resources" value={form.resources} onChange={value => update("resources", value)} error={errors.resources} /><Field label="Recursos dos beneficiários" id="version-beneficiary-resources" value={form.beneficiaryResources} onChange={value => update("beneficiaryResources", value)} optional /><p className="text-xs leading-5 text-muted-foreground">Informe os recursos separados por vírgula, por exemplo: Acesso ao sistema, Acesso pela web, Registro pelo WhatsApp.</p><div className="space-y-2"><Label htmlFor="version-cycle">Ciclo</Label><select id="version-cycle" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.cycle} onChange={event => update("cycle", event.target.value as VersionForm["cycle"])}><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></div><Field label="Motivo" id="version-reason" value={form.reason} onChange={value => update("reason", value)} error={errors.reason} textarea /><MutationError message={mutationError} /><Button className="w-full sm:w-auto" disabled={pending || Object.values(errors).some(Boolean)} onClick={onSubmit}>{pending ? "Criando versão..." : "Criar rascunho"}</Button></div></>;
}

export function CouponDialog({ form, setForm, pending, mutationError, onSubmit }: FormProps<CouponForm>) {
  const update = <K extends keyof CouponForm>(key: K, value: CouponForm[K]) => setForm(current => ({ ...current, [key]: value }));
  const percent = Number(form.percent); const cycles = splitCsv(form.cycles).filter(value => value === "monthly" || value === "yearly"); const duration = cycles.includes("yearly") ? 1 : Number(form.duration);
  const errors = { code: !form.code.trim() ? "Informe o código do cupom." : null, percent: !Number.isInteger(percent) || percent < 1 || percent > 30 ? "Informe um percentual inteiro entre 1% e 30%." : null, cycles: !cycles.length ? "Selecione mensal, anual ou ambos." : null, duration: !Number.isInteger(duration) || duration < 1 || duration > 3 ? "Informe de 1 a 3 cobranças para o ciclo mensal." : null, reason: form.reason.trim().length < 3 ? "Informe um motivo com pelo menos 3 caracteres." : null };
  return <><DialogHeader><DialogTitle>Novo cupom</DialogTitle><DialogDescription>Crie uma nova revisão percentual para novas contratações elegíveis.</DialogDescription></DialogHeader><div className="space-y-4"><Field label="Código do cupom" id="coupon-code" value={form.code} onChange={value => update("code", value)} error={errors.code} /><div className="grid gap-4 sm:grid-cols-2"><Field label="Percentual" id="coupon-percent" value={form.percent} onChange={value => update("percent", value)} error={errors.percent} /><Field label="Cobranças com desconto" id="coupon-duration" value={form.duration} onChange={value => update("duration", value)} error={errors.duration} /></div><div className="space-y-2"><Label htmlFor="coupon-cycles">Ciclos</Label><select id="coupon-cycles" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.cycles} onChange={event => update("cycles", event.target.value)}><option value="monthly">Mensal</option><option value="yearly">Anual</option><option value="monthly,yearly">Mensal e anual</option></select>{errors.cycles ? <p role="alert" className="text-xs text-destructive">{errors.cycles}</p> : null}</div><Field label="Produtos elegíveis" id="coupon-products" value={form.products} onChange={value => update("products", value)} optional /><p className="text-xs leading-5 text-muted-foreground">No ciclo mensal, o desconto pode valer de 1 a 3 cobranças. Se o ciclo anual estiver incluído, o desconto fica restrito à primeira cobrança.</p><Field label="Motivo" id="coupon-reason" value={form.reason} onChange={value => update("reason", value)} error={errors.reason} textarea /><MutationError message={mutationError} /><Button className="w-full sm:w-auto" disabled={pending || Object.values(errors).some(Boolean)} onClick={onSubmit}>{pending ? "Criando cupom..." : "Criar revisão"}</Button></div></>;
}
