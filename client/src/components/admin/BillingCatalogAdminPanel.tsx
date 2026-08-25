import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Layers3, RefreshCw, TicketPercent } from "lucide-react";
import React, { useState } from "react";
import { toast } from "sonner";

function csv(value: string) {
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

function currency(value: number, code = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(value / 100);
}

function confirmSensitiveAction(message: string) {
  return window.confirm(message);
}

export default function BillingCatalogAdminPanel() {
  const utils = trpc.useUtils();
  const versions = trpc.billing.adminCatalogVersions.useQuery({ limit: 100 }, { retry: false });
  const coupons = trpc.billing.adminCoupons.useQuery({ limit: 100 }, { retry: false });

  const [productCode, setProductCode] = useState("");
  const [productName, setProductName] = useState("");
  const [productAudience, setProductAudience] = useState<"individual" | "professional">("individual");
  const [productReason, setProductReason] = useState("");
  const [catalogActionReason, setCatalogActionReason] = useState("");

  const [versionProductCode, setVersionProductCode] = useState("");
  const [versionName, setVersionName] = useState("");
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [priceReais, setPriceReais] = useState("");
  const [capacity, setCapacity] = useState("");
  const [entitlements, setEntitlements] = useState("system_access,web_access,whatsapp_access");
  const [beneficiaryEntitlements, setBeneficiaryEntitlements] = useState("");
  const [versionReason, setVersionReason] = useState("");

  const [couponCode, setCouponCode] = useState("");
  const [couponPercent, setCouponPercent] = useState("10");
  const [couponDurationCharges, setCouponDurationCharges] = useState("1");
  const [couponCycles, setCouponCycles] = useState("monthly");
  const [couponProducts, setCouponProducts] = useState("");
  const [couponReason, setCouponReason] = useState("");

  const refresh = async () => {
    await Promise.all([
      utils.billing.adminCatalogVersions.invalidate({ limit: 100 }),
      utils.billing.adminCoupons.invalidate({ limit: 100 }),
      utils.billing.adminAnalytics.invalidate(),
    ]);
  };

  const createProduct = trpc.billing.adminCreateCatalogProduct.useMutation({
    onSuccess: async () => { toast.success("Família de produto criada."); setProductCode(""); setProductName(""); setProductReason(""); await refresh(); },
    onError: error => toast.error(error.message || "Não foi possível criar o produto."),
  });
  const createVersion = trpc.billing.adminCreateCatalogVersion.useMutation({
    onSuccess: async result => { toast.success(`Versão ${result.versionCode} criada como rascunho.`); setVersionReason(""); await refresh(); },
    onError: error => toast.error(error.message || "Não foi possível criar a versão."),
  });
  const publishVersion = trpc.billing.adminPublishCatalogVersion.useMutation({
    onSuccess: async () => { toast.success("Versão publicada para novas contratações."); setCatalogActionReason(""); await refresh(); },
    onError: error => toast.error(error.message || "Não foi possível publicar a versão."),
  });
  const deactivateVersion = trpc.billing.adminDeactivateCatalogVersion.useMutation({
    onSuccess: async () => { toast.success("Versão encerrada para novas contratações."); setCatalogActionReason(""); await refresh(); },
    onError: error => toast.error(error.message || "Não foi possível encerrar a versão."),
  });
  const createCoupon = trpc.billing.adminCreateCouponRevision.useMutation({
    onSuccess: async () => { toast.success("Revisão de cupom criada."); setCouponReason(""); await refresh(); },
    onError: error => toast.error(error.message || "Não foi possível criar o cupom."),
  });
  const deactivateCoupon = trpc.billing.adminDeactivateCoupon.useMutation({
    onSuccess: async () => { toast.success("Cupom desativado para novos usos."); setCatalogActionReason(""); await refresh(); },
    onError: error => toast.error(error.message || "Não foi possível desativar o cupom."),
  });

  const requireCatalogActionReason = () => {
    const reason = catalogActionReason.trim();
    if (reason.length < 3) {
      toast.error("Informe um motivo auditável antes de publicar, encerrar ou desativar.");
      return null;
    }
    return reason;
  };

  const submitProduct = () => {
    if (productCode.trim().length < 2 || productName.trim().length < 2 || productReason.trim().length < 3) return;
    createProduct.mutate({ code: productCode.trim(), audience: productAudience, name: productName.trim(), description: null, reason: productReason.trim(), provenance: { origin: "admin_manual" } });
  };

  const submitVersion = () => {
    const unitAmount = Math.round(Number(priceReais.replace(",", ".")) * 100);
    const capacityLimit = capacity.trim() ? Number(capacity) : null;
    const versionEntitlements = csv(entitlements);
    if (!versionProductCode.trim() || !versionName.trim() || !Number.isInteger(unitAmount) || unitAmount <= 0 || versionEntitlements.length === 0 || versionReason.trim().length < 3) return;
    createVersion.mutate({
      productCode: versionProductCode.trim(), name: versionName.trim(), description: null, billingCycle: cycle, currency: "BRL", unitAmount,
      capacityLimit: capacityLimit && Number.isInteger(capacityLimit) && capacityLimit > 0 ? capacityLimit : null,
      entitlements: versionEntitlements, coveredBeneficiaryEntitlements: csv(beneficiaryEntitlements), commercialPaymentMethods: ["credit_card", "pix_automatic"],
      effectiveFrom: new Date(), effectiveUntil: null, sortOrder: 1000, reason: versionReason.trim(), provenance: { origin: "admin_manual" },
    });
  };

  const submitCoupon = () => {
    const discountValue = Number(couponPercent);
    const requestedDuration = Number(couponDurationCharges);
    const eligibleCycles = csv(couponCycles).filter((value): value is "monthly" | "yearly" => value === "monthly" || value === "yearly");
    const durationCharges = eligibleCycles.includes("yearly") ? 1 : requestedDuration;
    if (!couponCode.trim() || !Number.isInteger(discountValue) || discountValue <= 0 || discountValue > 30 || eligibleCycles.length === 0 || !Number.isInteger(durationCharges) || durationCharges < 1 || durationCharges > 3 || couponReason.trim().length < 3) return;
    createCoupon.mutate({
      code: couponCode.trim(), discountType: "percentage", discountValue, currency: null,
      eligibleProductCodes: csv(couponProducts), eligibleVersionCodes: [], eligibleCycles,
      validFrom: new Date(), validUntil: null, maxTotalUses: null, maxUsesPerUser: 1, firstContractOnly: true,
      durationCharges, active: true, reason: couponReason.trim(),
    });
  };

  const handlePublish = (versionCode: string) => {
    const reason = requireCatalogActionReason();
    if (!reason || !confirmSensitiveAction(`Publicar ${versionCode} para novas contratações?`)) return;
    publishVersion.mutate({ versionCode, effectiveFrom: new Date(), reason, provenance: { origin: "admin_manual" } });
  };

  const handleDeactivateVersion = (versionCode: string) => {
    const reason = requireCatalogActionReason();
    if (!reason || !confirmSensitiveAction(`Encerrar ${versionCode} para novas contratações? Contratos existentes não serão alterados.`)) return;
    deactivateVersion.mutate({ versionCode, effectiveUntil: new Date(), reason });
  };

  const handleDeactivateCoupon = (code: string) => {
    const reason = requireCatalogActionReason();
    if (!reason || !confirmSensitiveAction(`Desativar o cupom ${code} para novos usos?`)) return;
    deactivateCoupon.mutate({ code, reason });
  };

  return (
    <section className="space-y-6" aria-labelledby="billing-catalog-admin-title">
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle id="billing-catalog-admin-title" className="flex items-center gap-2"><Layers3 className="h-5 w-5" />Catálogo e versões</CardTitle><CardDescription>Versões contratadas são imutáveis. Mudanças comerciais criam nova versão e publicação explícita.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label htmlFor="catalog-action-reason">Motivo para publicar, encerrar ou desativar</Label><Textarea id="catalog-action-reason" value={catalogActionReason} onChange={event => setCatalogActionReason(event.target.value)} placeholder="Justificativa auditável da próxima ação sensível" /></div>
            <div className="grid gap-3 md:grid-cols-2">
              {versions.data?.map(version => (
                <article key={version.id} className="rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-2"><div><p className="font-medium">{version.name}</p><p className="text-xs text-muted-foreground">{version.productCode} · {version.versionCode}</p></div><Badge variant={version.status === "active" ? "default" : "secondary"}>{version.status}</Badge></div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs"><Badge variant="outline">{version.billingCycle}</Badge><Badge variant="outline">{currency(version.unitAmount, version.currency)}</Badge>{version.capacityLimit ? <Badge variant="outline">cap. {version.capacityLimit}</Badge> : null}</div>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">{version.entitlements.join(", ")}</p>
                  <div className="mt-3 flex gap-2">
                    {version.status === "draft" ? <Button size="sm" variant="outline" onClick={() => handlePublish(version.versionCode)}>Publicar</Button> : null}
                    {version.status === "active" ? <Button size="sm" variant="outline" onClick={() => handleDeactivateVersion(version.versionCode)}>Encerrar</Button> : null}
                  </div>
                </article>
              ))}
            </div>
            {versions.isError ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar o catálogo administrativo.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><TicketPercent className="h-5 w-5" />Cupons</CardTitle><CardDescription>Um cupom por contratação, sem acumulação. Percentuais públicos acima de 30% e 100% são rejeitados pelo domínio.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {coupons.data?.map(coupon => <div key={coupon.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div><p className="font-medium">{coupon.code}</p><p className="text-xs text-muted-foreground">rev. {coupon.revision} · {coupon.discountType === "percentage" ? `${coupon.discountValue}%` : coupon.discountValue} · {coupon.durationCharges} cobrança(s)</p></div><div className="flex items-center gap-2"><Badge variant={coupon.state === "active" ? "default" : "secondary"}>{coupon.state}</Badge>{coupon.state === "active" ? <Button size="sm" variant="outline" onClick={() => handleDeactivateCoupon(coupon.code)}>Desativar</Button> : null}</div></div>)}
            {!coupons.isLoading && !coupons.data?.length ? <p className="text-sm text-muted-foreground">Nenhum cupom cadastrado.</p> : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card><CardHeader><CardTitle>Nova família</CardTitle><CardDescription>Cria a família sem alterar contratos existentes.</CardDescription></CardHeader><CardContent className="space-y-3"><TextField label="Código" value={productCode} onChange={setProductCode} /><TextField label="Nome" value={productName} onChange={setProductName} /><div className="space-y-2"><Label htmlFor="product-audience">Público</Label><select id="product-audience" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={productAudience} onChange={event => setProductAudience(event.target.value as "individual" | "professional")}><option value="individual">Individual</option><option value="professional">Profissional</option></select></div><Reason value={productReason} onChange={setProductReason} id="product-reason" /><Button className="w-full" disabled={createProduct.isPending} onClick={submitProduct}>Criar família</Button></CardContent></Card>

        <Card><CardHeader><CardTitle>Nova versão</CardTitle><CardDescription>Preço, capacidade e entitlements ficam congelados após contratação.</CardDescription></CardHeader><CardContent className="space-y-3"><TextField label="Produto" value={versionProductCode} onChange={setVersionProductCode} /><TextField label="Nome da versão" value={versionName} onChange={setVersionName} /><div className="grid gap-3 sm:grid-cols-2"><TextField label="Preço (R$)" value={priceReais} onChange={setPriceReais} /><TextField label="Capacidade" value={capacity} onChange={setCapacity} /></div><TextField label="Entitlements" value={entitlements} onChange={setEntitlements} /><TextField label="Entitlements do beneficiário" value={beneficiaryEntitlements} onChange={setBeneficiaryEntitlements} /><div className="space-y-2"><Label htmlFor="version-cycle">Ciclo</Label><select id="version-cycle" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={cycle} onChange={event => setCycle(event.target.value as "monthly" | "yearly")}><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></div><Reason value={versionReason} onChange={setVersionReason} id="version-reason" /><Button className="w-full" disabled={createVersion.isPending} onClick={submitVersion}>Criar rascunho</Button></CardContent></Card>

        <Card><CardHeader><CardTitle>Novo cupom percentual</CardTitle><CardDescription>Cria uma revisão nova; cobranças confirmadas não são alteradas retroativamente.</CardDescription></CardHeader><CardContent className="space-y-3"><TextField label="Código do cupom" value={couponCode} onChange={setCouponCode} /><div className="grid gap-3 sm:grid-cols-2"><TextField label="Percentual" value={couponPercent} onChange={setCouponPercent} /><TextField label="Cobranças com desconto" value={couponDurationCharges} onChange={setCouponDurationCharges} /></div><TextField label="Ciclos" value={couponCycles} onChange={setCouponCycles} /><TextField label="Produtos elegíveis" value={couponProducts} onChange={setCouponProducts} /><p className="text-xs text-muted-foreground">Mensal aceita de 1 a 3 cobranças. Se o ciclo anual estiver incluído, o desconto é restrito à primeira cobrança.</p><Reason value={couponReason} onChange={setCouponReason} id="coupon-reason" /><Button className="w-full" disabled={createCoupon.isPending} onClick={submitCoupon}>Criar revisão</Button></CardContent></Card>
      </div>

      <div className="flex justify-end"><Button variant="ghost" onClick={() => void refresh()}><RefreshCw className="h-4 w-4" />Atualizar catálogo</Button></div>
    </section>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = `catalog-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} value={value} onChange={event => onChange(event.target.value)} /></div>;
}

function Reason({ value, onChange, id }: { value: string; onChange: (value: string) => void; id: string }) {
  return <div className="space-y-2"><Label htmlFor={id}>Motivo</Label><Textarea id={id} value={value} onChange={event => onChange(event.target.value)} placeholder="Justificativa auditável" /></div>;
}
