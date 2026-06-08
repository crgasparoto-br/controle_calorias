# Design tecnico: API do catalogo global de alimentos

Parent: #150
Issues: #154, #161, #162, #163
Depends on: #151, #152

## Objetivo

A API do catalogo global expoe consultas para alimentos globais e personalizados sem alterar a busca legada ainda usada pelo frontend atual. Esta fatia tambem inclui sinais por usuario para favoritos/recentes e curadoria administrativa minima para status e merge de alimentos globais.

## Procedures tRPC

| Procedure | Entrada | Saida |
|---|---|---|
| `foods.catalogSearch` | `{ query?: string, limit?: number, includeInactive?: boolean }` | Lista de alimentos acessiveis ao usuario |
| `foods.catalogGet` | `{ foodId: number }` | Alimento acessivel ao usuario com porcoes |
| `foods.catalogRecent` | `{ limit?: number }` | Alimentos do catalogo usados recentemente pelo usuario |
| `foods.catalogFavorite` | `{ foodId: number, favorite: boolean }` | Alimento com `userSignals.favorite` atualizado |
| `admin.curateGlobalFood` | `{ foodId: number, status: "active" | "deprecated" | "merged", mergedIntoFoodId?: number }` | Alimento global curado |

A busca legada `foods.search`, `foods.recent` e `foods.favorite` permanece ativa para compatibilidade com `foodCatalog` ate a migracao de frontend e registro manual.

## Regra de escopo

A consulta sempre aplica:

```text
foods.owner_user_id IS NULL OR foods.owner_user_id = <usuario autenticado>
```

Assim:

- alimentos globais ficam visiveis para todos;
- alimentos personalizados so aparecem para o usuario dono;
- tentativa de consultar alimento personalizado de outro usuario retorna `NOT_FOUND`;
- usuarios comuns nao alteram alimentos globais, apenas seus sinais de favorito/uso.

## Busca

`foods.catalogSearch` procura em:

- `foods.normalized_name`
- `food_aliases.normalized_alias`

Por padrao, a busca retorna apenas alimentos `active`. Quando `includeInactive` e `true`, alimentos `deprecated` e `merged` tambem podem aparecer, mas ficam rebaixados no ranking.

## Favoritos e recentes

A tabela `user_food_favorites` guarda favoritos do usuario para qualquer alimento acessivel do novo catalogo. A tabela `user_food_usage_stats` guarda contagem e ultimo uso por usuario/alimento.

O uso recente e registrado quando uma refeicao resolve um item com `foodId` e gera snapshot nutricional. Essa gravacao atualiza `usage_count`, `last_used_at` e `updated_at`.

Cada alimento retorna:

```ts
userSignals: {
  favorite: boolean;
  usageCount: number;
  lastUsedAt: string | null;
}
```

## Ranking

A ordenacao prioriza:

1. alimentos `active`;
2. favoritos do usuario;
3. alimentos usados recentemente;
4. maior frequencia de uso;
5. match exato de nome normalizado;
6. match por prefixo;
7. alimentos com fonte registrada;
8. alimentos globais;
9. nome alfabetico.

## Curadoria administrativa

`admin.curateGlobalFood` permite que administradores alterem somente alimentos globais (`owner_user_id IS NULL`). A curadoria cobre:

- reativar item (`active`);
- descontinuar item (`deprecated`);
- marcar item como mesclado (`merged`) apontando para outro alimento global via `mergedIntoFoodId`.

O schema impede merge sem destino e impede que um alimento seja mesclado nele mesmo.

## Contrato de resposta

Cada alimento retorna:

- identificacao e escopo (`global` ou `user`);
- fonte, versao e codigo de origem quando existirem;
- nome, categoria, marca e status;
- sinais por usuario (`userSignals`);
- nutrientes por 100 g;
- nutrientes extras parseados de `nutrients_json`;
- porcoes cadastradas em `catalogGet`.

## Compatibilidade

A implementacao usa SQL parametrizado contra as tabelas do catalogo global. As rotas legadas continuam intactas para que a migração de interface possa acontecer em uma PR separada, sem quebrar telas existentes.
