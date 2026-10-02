# Adapter Open Food Facts — consulta opt-in por código de barras


> No Food Intelligence V2, este adapter é uma **fonte externa de evidência/candidatos**, não um resolvedor nem uma autoridade de publicação. A decisão final continua pertencendo ao resolvedor de domínio descrito em `adr-food-intelligence-resolver-v2.md`; o rollout atual abaixo permanece válido enquanto o adapter estiver em uso.


## Estado de rollout

A integração está implementada como **adapter de fase 2**, desligado por padrão. Ela não é fonte do catálogo local, não executa sincronização em massa e não publica candidatos.

Para habilitar somente em ambiente controlado:

```bash
OPEN_FOOD_FACTS_ENABLED=true
OPEN_FOOD_FACTS_USER_AGENT='ControleCalorias/1.0 (contato@exemplo.com)'
```

A consulta pública é `nutrition.foods.lookupOpenFoodFacts` e recebe somente um código de barras em uma ação explícita. Não existe chamada no autocomplete, na busca por nome ou no carregamento da tela.

## Fronteira e comportamento

- `server/modules/foods/openFoodFactsProvider.ts` é a única fronteira com o provider.
- O endpoint usa o backend, o endpoint de produto da API v2 e um `User-Agent` identificável.
- O adapter normaliza EAN/UPC mantendo zeros à esquerda e rejeita códigos fora de 8–14 dígitos.
- O adapter solicita apenas campos necessários para identidade, porção e nutrientes.
- O cache em memória dura 10 minutos por código; não é um mecanismo de sincronização nem de persistência do catálogo.
- Há timeout de 4 segundos e no máximo um retry para 429/5xx, com backoff curto.
- Estados distintos: `disabled`, `invalid_barcode`, `found`, `incomplete`, `not_found`, `rate_limited` e `unavailable`.
- Nutrientes ausentes são `null`, nunca zero. Para uma resposta incompleta, a proposta permanece fora do catálogo.
- O resultado é um `external_product_candidate` com código consultado, versão `api-v2`, data, URL de produto, disponibilidade por campo e atribuição.
- Imagens não são importadas; direitos da imagem não são presumidos.
- Nenhuma chamada de busca por texto é feita. O comportamento segue a política oficial contra search-as-you-type.

## Decisão de fonte

O Open Food Facts é uma base colaborativa. A documentação oficial alerta que os dados podem não ser exatos, completos ou confiáveis. Portanto, a resposta externa é uma **sugestão/candidato**, nunca um `food` publicado e nunca uma confirmação de identidade ou de nutrientes.

A precedência permanece:

1. rótulo/evidência revisada pelo administrador;
2. catálogo local aprovado;
3. sugestão externa Open Food Facts, somente como proposta para revisão.

## Limites de volume e licença

A documentação oficial consultada em 2026-09-28 informa limite de 15 requisições/minuto/IP para leituras de produto e recomenda uma chamada por ação real do usuário. A API não deve ser usada para scraping, autocomplete ou sincronização em massa. Para volume analítico, o provider recomenda exports oficiais ou uma instância local, o que exige outra avaliação.

A atribuição usada pelo adapter é:

> Contains data from Open Food Facts, available under the Open Database License

Referências oficiais:

- [API documentation](https://openfoodfacts.github.io/openfoodfacts-server/api/)
- [Barcode product tutorial](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorial-off-api/)
- [Data reuse and license](https://world.openfoodfacts.org/data)
- [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)

A base usa ODbL; conteúdos individuais usam DbCL; imagens usam CC-BY-SA e podem conter direitos adicionais. A feature não reutiliza imagens e qualquer ativação pública precisa manter atribuição visível e revisar as obrigações de derivados.

## Relatório de amostra brasileira antes do rollout

O primeiro relatório executado está em [`docs/testing/open-food-facts-sample-2026-09-28.md`](../testing/open-food-facts-sample-2026-09-28.md). Ele mantém o rollout bloqueado: a amostra observou disponibilidade transitória do provider, não fez pareamento com rótulos oficiais e não autoriza publicação automática.

A ativação em produção permanece bloqueada até a execução e revisão de uma amostra representativa de códigos brasileiros. O relatório deve registrar apenas métricas e códigos de fixture/consentidos, sem payload nutricional completo ou dados pessoais:

| Dimensão | Resultado | Evidência |
|---|---:|---|
| EANs brasileiros consultados | pendente | fixture versionada + data |
| Produtos encontrados | pendente | status do adapter |
| Identidade nome/marca/variante completa | pendente | disponibilidade por campo |
| kcal e macros por 100 g/100 ml completos | pendente | disponibilidade por campo |
| Porção/unidade conhecidas | pendente | disponibilidade por campo |
| Divergência contra embalagem/rótulo oficial | pendente | revisão manual |
| Não encontrados, 429 e timeouts | pendente | métricas sanitizadas |

Sem esse relatório, `OPEN_FOOD_FACTS_ENABLED` deve permanecer ausente ou diferente de `true`.

## Desligamento e fallback

Desligar `OPEN_FOOD_FACTS_ENABLED` retorna `disabled` sem executar rede. A consulta do catálogo local, o cadastro manual e o fluxo de candidatos de rótulo não dependem desse adapter.
