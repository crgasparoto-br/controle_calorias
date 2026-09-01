import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import {
  CouponDialog,
  Field,
  initialCoupon,
  initialProduct,
  initialVersion,
  ProductDialog,
  splitCsv,
  VersionDialog,
  type CouponForm,
  type ProductForm,
  type VersionForm,
} from "./BillingCatalogAdminForms";
import { billingAdminMutationErrorMessage } from "./billingAdminMutationErrors";
import { Layers3, Plus, RefreshCw, TicketPercent } from "lucide-react";
import React, { useRef, useState } from "react";
import { toast } from "sonner";

type Flow = "product" | "version" | "coupon";
type Sensitive = { kind: "publish" | "deactivate-version" | "deactivate-coupon"; code: string; reason: string };

const money = (minor: number, code = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(minor / 100);

function actionCopy(action: Sensitive | null) {
  if (!action) return null;
  if (action.kind === "publish") return { title: `Publicar versão ${action.code}?`, description: "A versão ficará disponível para novas contratações. Contratos existentes não serão alterados.", label: "Publicar versão", destructive: false };
  if (action.kind === "deactivate-version") return { title: `Encerrar versão ${action.code}?`, description: "A versão deixará de aceitar novas contratações. Contratos existentes continuarão preservados.", label: "Encerrar versão", destructive: true };
  return { title: `Desativar cupom ${action.code}?`, description: "O cupom deixará de ser aceito em novos usos. Utilizações já confirmadas não serão alteradas.", label: "Desativar cupom", destructive: true };
}

export default function BillingCatalogAdminPanel() {
  const utils = trpc.useUtils();
  const versions = trpc.billing.adminCatalogVersions.useQuery({ limit: 100 }, { retry: false });
  const coupons = trpc.billing.adminCoupons.useQuery({ limit: 100 }, { retry: false });
  const [flow, setFlow] = useState<Flow | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [product, setProduct] = useState<ProductForm>(initialProduct);
  const [version, setVersion] = useState<VersionForm>(initialVersion);
  const [coupon, setCoupon] = useState<CouponForm>(initialCoupon);
  const [actionReason, setActionReason] = useState("");
  const [sensitive, setSensitive] = useState<Sensitive | null>(null);
  const lastFlow = useRef<Flow>("product");
  const triggers = {
    product: useRef<HTMLButtonElement>(null),
    version: useRef<HTMLButtonElement>(null),
    coupon: useRef<HTMLButtonElement>(null),
  };

  const refresh = async () => {
    await Promise.all([
      utils.billing.adminCatalogVersions.invalidate({ limit: 100 }),
      utils.billing.adminCoupons.invalidate({ limit: 100 }),
      utils.billing.adminAnalytics.invalidate(),
    ]);
  };

  const reportFlowError = (
    key: "createProduct" | "createVersion" | "createCoupon",
    error: unknown
  ) => {
    const message = billingAdminMutationErrorMessage(key, error);
    setFlowError(message);
    toast.error(message);
  };

  const reportSensitiveError = (
    key: "publishVersion" | "deactivateVersion" | "deactivateCoupon",
    error: unknown
  ) => {
    toast.error(billingAdminMutationErrorMessage(key, error));
  };

  const createProduct = trpc.billing.adminCreateCatalogProduct.useMutation({
    onSuccess: async () => { toast.success("Família de produto criada."); setProduct(initialProduct); setFlowError(null); setFlow(null); await refresh(); },
    onError: error => reportFlowError("createProduct", error),
  });
  const createVersion = trpc.billing.adminCreateCatalogVersion.useMutation({
    onSuccess: async result => { toast.success(`Versão ${result.versionCode} criada como rascunho.`); setVersion(initialVersion); setFlowError(null); setFlow(null); await refresh(); },
    onError: error => reportFlowError("createVersion", error),
  });
  const publishVersion = trpc.billing.adminPublishCatalogVersion.useMutation({
    onSuccess: async () => { toast.success("Versão publicada para novas contratações."); setActionReason(""); await refresh(); },
    onError: error => reportSensitiveError("publishVersion", error),
  });
  const deactivateVersion = trpc.billing.adminDeactivateCatalogVersion.useMutation({
    onSuccess: async () => { toast.success("Versão encerrada para novas contratações."); setActionReason(""); await refresh(); },
    onError: error => reportSensitiveError("deactivateVersion", error),
  });
  const createCoupon = trpc.billing.adminCreateCouponRevision.useMutation({
    onSuccess: async () => { toast.success("Revisão de cupom criada."); setCoupon(initialCoupon); setFlowError(null); setFlow(null); await refresh(); },
    onError: error => reportFlowError("createCoupon", error),
  });
  const deactivateCoupon = trpc.billing.adminDeactivateCoupon.useMutation({
    onSuccess: async () => { toast.success("Cupom desativado para novos usos."); setActionReason(""); await refresh(); },
    onError: error => reportSensitiveError("deactivateCoupon", error),
  });

  const openFlow = (next: Flow) => { lastFlow.current = next; setFlowError(null); setFlow(next); };
  const closeFlow = () => { setFlowError(null); setFlow(null); };
  const askSensitive = (kind: Sensitive["kind"], code: string) => {
    const reason = actionReason.trim();
    if (reason.length < 3) return toast.error("Informe um motivo com pelo menos 3 caracteres antes da ação sensível.");
    setSensitive({ kind, code, reason });
  };
  const confirmSensitive = () => {
    const action = sensitive;
    if (!action) return;
    setSensitive(null);
    if (action.kind === "publish") return publishVersion.mutate({ versionCode: action.code, effectiveFrom: new Date(), reason: action.reason, provenance: { origin: "admin_manual" } });
    if (action.kind === "deactivate-version") return deactivateVersion.mutate({ versionCode: action.code, effectiveUntil: new Date(), reason: action.reason });
    deactivateCoupon.mutate({ code: action.code, reason: action.reason });
  };
  const pendingSensitive = publishVersion.isPending || deactivateVersion.isPending || deactivateCoupon.isPending;
  const copy = actionCopy(sensitive);

  return (
    <section className="space-y-6" aria-labelledby="billing-catalog-admin-title">
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="billing-catalog-admin-title" className="font-semibold tracking-tight">Catálogo comercial</h2>
          <p className="mt-1 text-sm text-muted-foreground">Consulte produtos, versões e cupons e abra apenas o formulário que precisa usar.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NewButton ref={triggers.product} label="Novo produto" onClick={() => openFlow("product")} />
          <NewButton ref={triggers.version} label="Nova versão" onClick={() => openFlow("version")} />
          <NewButton ref={triggers.coupon} label="Novo cupom" onClick={() => openFlow("coupon")} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Layers3 className="h-5 w-5" />Catálogo e versões</CardTitle><CardDescription>Versões contratadas permanecem preservadas; mudanças comerciais usam nova versão e publicação explícita.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Motivo para publicar, encerrar ou desativar" id="catalog-action-reason" value={actionReason} onChange={setActionReason} textarea error={actionReason.length > 0 && actionReason.trim().length < 3 ? "Informe um motivo com pelo menos 3 caracteres." : null} />
            <div className="grid gap-3 md:grid-cols-2">
              {versions.data?.map(item => <article key={item.id} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-2"><div><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.productCode} · {item.versionCode}</p></div><Badge variant={item.status === "active" ? "default" : "secondary"}>{item.status}</Badge></div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs"><Badge variant="outline">{item.billingCycle}</Badge><Badge variant="outline">{money(item.unitAmount, item.currency)}</Badge>{item.capacityLimit ? <Badge variant="outline">cap. {item.capacityLimit}</Badge> : null}</div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">Recursos incluídos: {item.entitlements.join(", ")}</p>
                <div className="mt-3 flex flex-wrap gap-2">{item.status === "draft" ? <Button size="sm" onClick={() => askSensitive("publish", item.versionCode)}>Publicar</Button> : null}{item.status === "active" ? <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => askSensitive("deactivate-version", item.versionCode)}>Encerrar</Button> : null}</div>
              </article>)}
            </div>
            {versions.isLoading ? <p role="status" className="text-sm text-muted-foreground">Carregando catálogo e versões...</p> : null}
            {versions.isError ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar o catálogo administrativo.</p> : null}
            {!versions.isLoading && !versions.isError && !versions.data?.length ? <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">Nenhuma versão cadastrada.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><TicketPercent className="h-5 w-5" />Cupons</CardTitle><CardDescription>Consulte as revisões e desative novos usos quando necessário.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {coupons.data?.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div><p className="font-medium">{item.code}</p><p className="text-xs text-muted-foreground">rev. {item.revision} · {item.discountType === "percentage" ? `${item.discountValue}%` : item.discountValue} · {item.durationCharges} cobrança(s)</p></div><div className="flex items-center gap-2"><Badge variant={item.state === "active" ? "default" : "secondary"}>{item.state}</Badge>{item.state === "active" ? <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => askSensitive("deactivate-coupon", item.code)}>Desativar</Button> : null}</div></div>)}
            {coupons.isLoading ? <p role="status" className="text-sm text-muted-foreground">Carregando cupons...</p> : null}
            {coupons.isError ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar os cupons.</p> : null}
            {!coupons.isLoading && !coupons.isError && !coupons.data?.length ? <p className="text-sm text-muted-foreground">Nenhum cupom cadastrado.</p> : null}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end"><Button variant="ghost" onClick={() => void refresh()}><RefreshCw className="h-4 w-4" />Atualizar catálogo</Button></div>

      <Dialog open={flow !== null} onOpenChange={open => { if (!open) closeFlow(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" onCloseAutoFocus={event => { event.preventDefault(); triggers[lastFlow.current].current?.focus(); }}>
          {flow === "product" ? <ProductDialog form={product} setForm={setProduct} pending={createProduct.isPending} mutationError={flowError ?? undefined} onSubmit={() => {
            if (product.code.trim().length < 2 || product.name.trim().length < 2 || product.reason.trim().length < 3) return;
            createProduct.mutate({ code: product.code.trim(), audience: product.audience, name: product.name.trim(), description: null, reason: product.reason.trim(), provenance: { origin: "admin_manual" } });
          }} /> : null}
          {flow === "version" ? <VersionDialog form={version} setForm={setVersion} pending={createVersion.isPending} mutationError={flowError ?? undefined} onSubmit={() => {
            const unitAmount = Math.round(Number(version.price.replace(",", ".")) * 100);
            const capacityLimit = version.capacity.trim() ? Number(version.capacity) : null;
            if (!version.productCode.trim() || !version.name.trim() || !Number.isInteger(unitAmount) || unitAmount <= 0 || (capacityLimit !== null && (!Number.isInteger(capacityLimit) || capacityLimit <= 0)) || !splitCsv(version.resources).length || version.reason.trim().length < 3) return;
            createVersion.mutate({ productCode: version.productCode.trim(), name: version.name.trim(), description: null, billingCycle: version.cycle, currency: "BRL", unitAmount, capacityLimit, entitlements: splitCsv(version.resources), coveredBeneficiaryEntitlements: splitCsv(version.beneficiaryResources), commercialPaymentMethods: ["credit_card", "pix_automatic"], effectiveFrom: new Date(), effectiveUntil: null, sortOrder: 1000, reason: version.reason.trim(), provenance: { origin: "admin_manual" } });
          }} /> : null}
          {flow === "coupon" ? <CouponDialog form={coupon} setForm={setCoupon} pending={createCoupon.isPending} mutationError={flowError ?? undefined} onSubmit={() => {
            const percent = Number(coupon.percent); const cycles = splitCsv(coupon.cycles).filter(value => value === "monthly" || value === "yearly") as ("monthly" | "yearly")[]; const duration = cycles.includes("yearly") ? 1 : Number(coupon.duration);
            if (!coupon.code.trim() || !Number.isInteger(percent) || percent < 1 || percent > 30 || !cycles.length || !Number.isInteger(duration) || duration < 1 || duration > 3 || coupon.reason.trim().length < 3) return;
            createCoupon.mutate({ code: coupon.code.trim(), discountType: "percentage", discountValue: percent, currency: null, eligibleProductCodes: splitCsv(coupon.products), eligibleVersionCodes: [], eligibleCycles: cycles, validFrom: new Date(), validUntil: null, maxTotalUses: null, maxUsesPerUser: 1, firstContractOnly: true, durationCharges: duration, active: true, reason: coupon.reason.trim() });
          }} /> : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={sensitive !== null} onOpenChange={open => { if (!open) setSensitive(null); }}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{copy?.title}</AlertDialogTitle><AlertDialogDescription>{copy?.description}</AlertDialogDescription></AlertDialogHeader><div className="rounded-xl bg-muted/30 p-3 text-sm text-muted-foreground">Motivo informado: <span className="font-medium text-foreground">{sensitive?.reason}</span></div><AlertDialogFooter><AlertDialogCancel disabled={pendingSensitive}>Cancelar</AlertDialogCancel><AlertDialogAction disabled={pendingSensitive} className={copy?.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined} onClick={confirmSensitive}>{copy?.label}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

const NewButton = React.forwardRef<HTMLButtonElement, { label: string; onClick: () => void }>(({ label, onClick }, ref) => <Button ref={ref} type="button" variant="outline" onClick={onClick}><Plus className="h-4 w-4" />{label}</Button>);
NewButton.displayName = "NewButton";
