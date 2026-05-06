import DashboardLayout from "@/components/DashboardLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { AlertCircle, PencilLine, Plus, Search, Star } from "lucide-react";
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
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Alimentos</h1>
          <p className="text-sm text-muted-foreground">Busque, favorite e cadastre alimentos com macros por porção.</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Busca</CardTitle>
                <CardDescription>Favoritos e usados recentemente aparecem primeiro.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input className="pl-9" value={query} onChange={event => setQuery(event.target.value)} placeholder="Ex.: arroz, iogurte, whey..." />
                </div>

                {foods.isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : foods.isError ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Não foi possível buscar</AlertTitle>
                    <AlertDescription>{foods.error.message}</AlertDescription>
                  </Alert>
                ) : visibleFoods.length ? (
                  <div className="grid gap-3">
                    {visibleFoods.map(food => (
                      <div key={food.id} className="rounded-lg border bg-background p-4">
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
                              <Button type="button" variant="outline" size="icon" onClick={() => setForm({
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
                              })}>
                                <PencilLine className="h-4 w-4" />
                              </Button>
                            ) : null}
                            <Button type="button" variant={food.isFavorite ? "default" : "outline"} size="icon" onClick={() => favoriteFood.mutate({ foodId: food.id, favorite: !food.isFavorite })} disabled={favoriteFood.isPending}>
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
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                    Nenhum alimento encontrado. Cadastre este alimento no formulário ao lado.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Usados recentemente</CardTitle>
              </CardHeader>
              <CardContent>
                {recent.isLoading ? <Skeleton className="h-16 w-full" /> : recent.data?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {recent.data.map(food => (
                      <Badge key={food.id} variant="secondary" className="cursor-pointer rounded-full px-3 py-1" onClick={() => setQuery(food.name)}>
                        {food.name}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Os alimentos aparecem aqui depois de serem usados em refeições.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle>{form.foodId ? "Editar alimento" : "Criar alimento"}</CardTitle>
              <CardDescription>Alimentos criados ficam disponíveis apenas para sua conta.</CardDescription>
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
                <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                  <Label>Classificação alimentar</Label>
                  <FoodCheckbox label="Fruta" checked={form.isFruit} onCheckedChange={isFruit => setForm(current => ({ ...current, isFruit }))} />
                  <FoodCheckbox label="Vegetal" checked={form.isVegetable} onCheckedChange={isVegetable => setForm(current => ({ ...current, isVegetable }))} />
                  <FoodCheckbox label="Ultraprocessado" checked={form.isUltraProcessed} onCheckedChange={isUltraProcessed => setForm(current => ({ ...current, isUltraProcessed }))} />
                </div>
                <div className="flex gap-3 pt-2">
                  <Button type="submit" disabled={createFood.isPending || updateFood.isPending}>
                    <Plus className="mr-2 h-4 w-4" />
                    {submitLabel}
                  </Button>
                  {form.foodId ? <Button type="button" variant="outline" onClick={() => setForm(emptyForm)}>Cancelar</Button> : null}
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
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
    <div className="rounded-md bg-muted/50 p-3">
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
