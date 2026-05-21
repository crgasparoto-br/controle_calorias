import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import UXState from "@/components/UXState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { PencilLine, Plus, Search, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type FoodFormState = {
  foodId?: number;
  name: string;
  brandName: string;
  servingSize: string;
  servingUnit: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
  isFruit: boolean;
  isVegetable: boolean;
  isUltraProcessed: boolean;
  source: string;
  foodType: "generic" | "branded";
};

const emptyForm: FoodFormState = {
  name: "",
  brandName: "",
  servingSize: "100",
  servingUnit: "g",
  calories: "",
  protein: "",
  carbs: "",
  fat: "",
  fiber: "",
  isFruit: false,
  isVegetable: false,
  isUltraProcessed: false,
  source: "manual",
  foodType: "generic",
};

function toNumber(value: string) {
  return Number(value.replace(",", ".")) || 0;
}

export default function FoodsPage() {
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<FoodFormState>(emptyForm);
  const utils = trpc.useUtils();
  const foods = trpc.nutrition.foods.search.useQuery({ query, limit: 30 });
  const recent = trpc.nutrition.foods.recent.useQuery();

  const favoriteFood = trpc.nutrition.foods.favorite.useMutation({
    onSuccess: () => {
      utils.nutrition.foods.search.invalidate();
      utils.nutrition.foods.recent.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const createFood = trpc.nutrition.foods.create.useMutation({
    onSuccess: food => {
      toast.success("Alimento cadastrado.");
      setForm(emptyForm);
      setQuery(food.name);
      utils.nutrition.foods.search.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const updateFood = trpc.nutrition.foods.update.useMutation({
    onSuccess: food => {
      toast.success("Alimento atualizado.");
      setForm(emptyForm);
      setQuery(food.name);
      utils.nutrition.foods.search.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const submitLabel = form.foodId ? "Salvar alimento" : "Criar alimento";
  const visibleFoods = foods.data ?? [];
  const recentFoods = recent.data ?? [];
  const favoriteCount = useMemo(() => visibleFoods.filter(food => food.isFavorite).length, [visibleFoods]);
  const userCreatedCount = useMemo(() => visibleFoods.filter(food => food.isUserCreated).length, [visibleFoods]);
  const classifiedCount = useMemo(
    () => visibleFoods.filter(food => food.isFruit || food.isVegetable || food.isUltraProcessed).length,
    [visibleFoods],
  );

  const formPayload = useMemo(() => ({
    name: form.name,
    brandName: form.brandName || null,
    servingSize: toNumber(form.servingSize),
    servingUnit: form.servingUnit,
    calories: toNumber(form.calories),
    protein: toNumber(form.protein),
    carbs: toNumber(form.carbs),
    fat: toNumber(form.fat),
    fiber: form.fiber ? toNumber(form.fiber) : null,
    isFruit: form.isFruit,
    isVegetable: form.isVegetable,
    isUltraProcessed: form.isUltraProcessed,
    source: form.source || "manual",
    foodType: form.foodType,
  }), [form]);

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <PageIntro
          eyebrow="Alimentos"
          title="Base alimentar do usuário"
          description="A tela agora separa busca, atalhos e cadastro para reduzir a competição entre consulta e edição. O fluxo continua o mesmo: encontrar um alimento, favoritá-lo ou ajustá-lo, e manter o cadastro consistente para os próximos registros."
          stats={
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <IntroStat label="Resultados" value={String(visibleFoods.length)} helper="itens visíveis na busca" />
              <IntroStat label="Favoritos" value={String(favoriteCount)} helper="na lista filtrada atual" />
              <IntroStat label="Recentes" value={String(recentFoods.length)} helper="atalhos de uso recente" />
              <IntroStat label="Classificados" value={String(classifiedCount)} helper="fruta, vegetal ou ultraprocessado" />
            </div>
          }
        />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.12fr)_420px] xl:grid-cols-[minmax(0,1.2fr)_420px]">
          <div className="space-y-6">
            <Tabs defaultValue="search" className="space-y-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <TabsList className="h-auto w-full flex-wrap rounded-2xl p-1 sm:w-auto">
                  <TabsTrigger value="search" className="min-w-[130px] rounded-xl px-4 py-2">Busca</TabsTrigger>
                  <TabsTrigger value="recent" className="min-w-[130px] rounded-xl px-4 py-2">Recentes</TabsTrigger>
                </TabsList>
                <div className="grid gap-3 sm:grid-cols-3 xl:w-[32rem]">
                  <SurfaceStat label="Busca atual" value={query.trim() ? query : "sem filtro"} />
                  <SurfaceStat label="Criados por você" value={userCreatedCount ? `${userCreatedCount} editáveis` : "nenhum neste filtro"} />
                  <SurfaceStat label="Favoritos" value={favoriteCount ? `${favoriteCount} em destaque` : "sem favoritos neste filtro"} />
                </div>
              </div>

              <TabsContent value="search">
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Buscar e revisar alimentos</CardTitle>
                    <CardDescription>Favoritos e usados recentemente continuam aparecendo primeiro, mas a leitura agora fica mais focada no resultado da busca.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input className="pl-9" value={query} onChange={event => setQuery(event.target.value)} placeholder="Ex.: arroz, iogurte, whey..." />
                    </div>

                    {foods.isLoading ? (
                      <div className="space-y-3">
                        <Skeleton className="h-24 w-full rounded-2xl" />
                        <Skeleton className="h-24 w-full rounded-2xl" />
                        <Skeleton className="h-24 w-full rounded-2xl" />
                      </div>
                    ) : foods.isError ? (
                      <UXState
                        variant="error"
                        title="Não foi possível buscar alimentos"
                        description={foods.error.message}
                      />
                    ) : visibleFoods.length ? (
                      <div className="grid gap-3">
                        {visibleFoods.map(food => (
                          <FoodResultCard
                            key={food.id}
                            food={food}
                            isFavoritePending={favoriteFood.isPending}
                            onEdit={() => setForm({
                              foodId: food.id,
                              name: food.name,
                              brandName: food.brandName ?? "",
                              servingSize: String(food.servingSize),
                              servingUnit: food.servingUnit,
                              calories: String(food.calories),
                              protein: String(food.protein),
                              carbs: String(food.carbs),
                              fat: String(food.fat),
                              fiber: food.fiber == null ? "" : String(food.fiber),
                              isFruit: food.isFruit,
                              isVegetable: food.isVegetable,
                              isUltraProcessed: food.isUltraProcessed,
                              source: food.source,
                              foodType: food.foodType,
                            })}
                            onToggleFavorite={() => favoriteFood.mutate({ foodId: food.id, favorite: !food.isFavorite })}
                          />
                        ))}
                      </div>
                    ) : (
                      <UXState
                        variant="empty"
                        title="Nenhum alimento encontrado"
                        description="Nenhum item apareceu nesta busca. Você pode criar o alimento no painel lateral para deixá-lo disponível nos próximos registros."
                      />
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="recent">
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Usados recentemente</CardTitle>
                    <CardDescription>Atalhos rápidos para retomar buscas comuns sem digitar de novo.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {recent.isLoading ? (
                      <Skeleton className="h-16 w-full rounded-2xl" />
                    ) : recentFoods.length ? (
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {recentFoods.map(food => (
                          <button
                            key={food.id}
                            type="button"
                            className="rounded-2xl border bg-background p-4 text-left transition hover:border-primary/30 hover:bg-primary/5"
                            onClick={() => setQuery(food.name)}
                          >
                            <p className="font-medium tracking-tight text-foreground">{food.name}</p>
                            <p className="mt-1 text-sm text-muted-foreground">Toque para trazer este alimento para a busca principal.</p>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <UXState
                        variant="empty"
                        title="Nenhum alimento recente ainda"
                        description="Os atalhos aparecem aqui depois que alimentos forem usados em refeições registradas no app."
                      />
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-6">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>{form.foodId ? "Editar alimento" : "Criar alimento"}</CardTitle>
                <CardDescription>Alimentos criados ficam disponíveis apenas para sua conta. A edição permanece no mesmo formulário para não mudar o comportamento existente.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={event => {
                  event.preventDefault();
                  if (form.foodId) {
                    updateFood.mutate({ foodId: form.foodId, ...formPayload });
                  } else {
                    createFood.mutate(formPayload);
                  }
                }}>
                  <Field label="Nome" value={form.name} onChange={name => setForm(current => ({ ...current, name }))} />
                  <Field label="Marca" value={form.brandName} onChange={brandName => setForm(current => ({ ...current, brandName, foodType: brandName ? "branded" : current.foodType }))} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Porção" value={form.servingSize} type="number" onChange={servingSize => setForm(current => ({ ...current, servingSize }))} />
                    <Field label="Unidade" value={form.servingUnit} onChange={servingUnit => setForm(current => ({ ...current, servingUnit }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Tipo</Label>
                    <Select value={form.foodType} onValueChange={(foodType: "generic" | "branded") => setForm(current => ({ ...current, foodType }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="generic">Genérico</SelectItem>
                        <SelectItem value="branded">Marca</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Calorias" value={form.calories} type="number" onChange={calories => setForm(current => ({ ...current, calories }))} />
                    <Field label="Proteínas" value={form.protein} type="number" onChange={protein => setForm(current => ({ ...current, protein }))} />
                    <Field label="Carboidratos" value={form.carbs} type="number" onChange={carbs => setForm(current => ({ ...current, carbs }))} />
                    <Field label="Gorduras" value={form.fat} type="number" onChange={fat => setForm(current => ({ ...current, fat }))} />
                    <Field label="Fibras" value={form.fiber} type="number" onChange={fiber => setForm(current => ({ ...current, fiber }))} />
                  </div>
                  <div className="space-y-3 rounded-2xl border bg-muted/20 p-4">
                    <Label>Classificação alimentar</Label>
                    <FoodCheckbox label="Fruta" checked={form.isFruit} onCheckedChange={isFruit => setForm(current => ({ ...current, isFruit }))} />
                    <FoodCheckbox label="Vegetal" checked={form.isVegetable} onCheckedChange={isVegetable => setForm(current => ({ ...current, isVegetable }))} />
                    <FoodCheckbox label="Ultraprocessado" checked={form.isUltraProcessed} onCheckedChange={isUltraProcessed => setForm(current => ({ ...current, isUltraProcessed }))} />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <Button type="submit" className="rounded-full" disabled={createFood.isPending || updateFood.isPending}>
                      <Plus className="mr-2 h-4 w-4" />
                      {submitLabel}
                    </Button>
                    {form.foodId ? <Button type="button" variant="outline" className="rounded-full" onClick={() => setForm(emptyForm)}>Cancelar</Button> : null}
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>Boas entradas para cadastro</CardTitle>
                <CardDescription>Referência rápida para manter a base mais consistente e útil nos próximos registros.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <FlowStep title="1. Nome claro" text="Prefira o nome mais reconhecível do alimento antes de detalhar marca ou classificação." />
                <FlowStep title="2. Porção confiável" text="Use uma porção de referência estável para facilitar comparação entre resultados e refeições." />
                <FlowStep title="3. Classificação útil" text="Marque fruta, vegetal ou ultraprocessado quando isso ajudar leitura de qualidade alimentar depois." />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function IntroStat({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
    </div>
  );
}

function SurfaceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background px-4 py-3 shadow-sm">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-medium leading-6 text-foreground">{value}</p>
    </div>
  );
}

function FoodResultCard({
  food,
  isFavoritePending,
  onEdit,
  onToggleFavorite,
}: {
  food: {
    id: number;
    name: string;
    brandName?: string | null;
    foodType: "generic" | "branded";
    lastUsedAt?: number | null;
    isFruit: boolean;
    isVegetable: boolean;
    isUltraProcessed: boolean;
    servingSize: number;
    servingUnit: string;
    source: string;
    isUserCreated: boolean;
    isFavorite: boolean;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber?: number | null;
  };
  isFavoritePending: boolean;
  onEdit: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold tracking-tight">{food.name}</p>
            {food.brandName ? <Badge variant="secondary">{food.brandName}</Badge> : null}
            <Badge variant="outline">{food.foodType === "branded" ? "Marca" : "Genérico"}</Badge>
            {food.lastUsedAt ? <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Recente</Badge> : null}
            {food.isFruit ? <Badge variant="secondary">Fruta</Badge> : null}
            {food.isVegetable ? <Badge variant="secondary">Vegetal</Badge> : null}
            {food.isUltraProcessed ? <Badge variant="outline">Ultraprocessado</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{food.servingSize} {food.servingUnit} por porção · fonte: {food.source}</p>
        </div>
        <div className="flex gap-2">
          {food.isUserCreated ? (
            <Button type="button" variant="outline" size="icon" className="rounded-full" onClick={onEdit}>
              <PencilLine className="h-4 w-4" />
            </Button>
          ) : null}
          <Button type="button" variant={food.isFavorite ? "default" : "outline"} size="icon" className="rounded-full" onClick={onToggleFavorite} disabled={isFavoritePending}>
            <Star className={food.isFavorite ? "h-4 w-4 fill-current" : "h-4 w-4"} />
          </Button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Macro label="Kcal" value={food.calories} />
        <Macro label="Proteínas" value={food.protein} unit="g" />
        <Macro label="Carboidratos" value={food.carbs} unit="g" />
        <Macro label="Gorduras" value={food.fat} unit="g" />
      </div>
    </div>
  );
}

function FoodCheckbox({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={value => onCheckedChange(value === true)} />
      {label}
    </label>
  );
}

function Macro({ label, value, unit = "" }: { label: string; value: number; unit?: string }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}{unit}</p>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} step={type === "number" ? "0.1" : undefined} value={value} onChange={event => onChange(event.target.value)} />
    </div>
  );
}

function FlowStep({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border bg-muted/20 p-4">
      <p className="font-medium tracking-tight">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}
