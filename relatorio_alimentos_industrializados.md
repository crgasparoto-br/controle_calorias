# Relatório de Extração de Tabelas Nutricionais (Alimentos Industrializados)

Este documento apresenta os dados nutricionais de diversos alimentos industrializados populares no Brasil, extraídos diretamente de seus sites oficiais ou bases de dados de rótulos confiáveis, como solicitado para o projeto `controle_calorias`.

## Resumo da Extração

Foram extraídos dados de **9 produtos** de **6 marcas diferentes** (Quaker, Nestlé, Maizena, Marilan, Danone e Pullman). Todos os dados foram padronizados para o formato de **100g** para facilitar a inserção no banco de dados, além de incluir a porção padrão de consumo.

Os dados já foram formatados em um arquivo JSON compatível com o script de importação do seu repositório: `scripts/import-foods/seeds/alimentos_industrializados_brasil.json`.

---

## Tabelas Nutricionais Extraídas

### 1. Marca: Quaker (PepsiCo) [1]

| Produto | Porção Padrão | Calorias (kcal/100g) | Carboidratos (g/100g) | Proteínas (g/100g) | Gorduras Totais (g/100g) | Fibras (g/100g) | Açúcares (g/100g) | Sódio (mg/100g) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Farelo de Aveia Oat Bran** | 10g (1 col. sopa) | 370 | 45,0 | 19,0 | 9,5 | 14,0 | 1,5 | 0 |
| **Farinha de Aveia Integral** | 50g (½ xícara) | 379 | 59,0 | 15,0 | 7,2 | 8,9 | 1,5 | 0 |

### 2. Marca: Nestlé [2][3][4]

| Produto | Porção Padrão | Calorias (kcal/100g) | Carboidratos (g/100g) | Proteínas (g/100g) | Gorduras Totais (g/100g) | Fibras (g/100g) | Açúcares (g/100g) | Sódio (mg/100g) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Achocolatado NESCAU® em Pó** | 20g (2 col. sopa) | 380 | 85,0 | 3,0 | 2,0 | 4,5 | 75,0 | 530 |
| **Leite Condensado MOÇA® (Lata)** | 20g (1 col. sopa) | 328 | 56,0 | 7,0 | 8,4 | 0,0 | 56,0 | 109 |
| **Leite em Pó NINHO® Integral** | 25g (2 col. sopa) | 496 | 37,6 | 25,6 | 26,8 | 0,0 | 36,0 | 392 |

### 3. Marca: Maizena (Unilever) [5]

| Produto | Porção Padrão | Calorias (kcal/100g) | Carboidratos (g/100g) | Proteínas (g/100g) | Gorduras Totais (g/100g) | Fibras (g/100g) | Açúcares (g/100g) | Sódio (mg/100g) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Amido de Milho** | 20g (1 col. sopa) | 350 | 85,0 | 0,0 | 0,0 | 0,0 | 0,0 | 25 |

### 4. Marca: Marilan [6]

| Produto | Porção Padrão | Calorias (kcal/100g) | Carboidratos (g/100g) | Proteínas (g/100g) | Gorduras Totais (g/100g) | Fibras (g/100g) | Açúcares (g/100g) | Sódio (mg/100g) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Biscoito Cream Cracker Manteiga** | 30g (6 biscoitos) | 392 | 67,0 | 8,6 | 10,0 | 2,9 | 6,0 | 551 |

### 5. Marca: Danone [7]

| Produto | Porção Padrão | Calorias (kcal/100g) | Carboidratos (g/100g) | Proteínas (g/100g) | Gorduras Totais (g/100g) | Fibras (g/100g) | Açúcares (g/100g) | Sódio (mg/100g) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Iogurte Natural Integral** | 160g (1 copo) | 75 | 6,25 | 4,69 | 3,56 | 0,0 | 6,25 | 54 |

### 6. Marca: Pullman (Bimbo) [8]

| Produto | Porção Padrão | Calorias (kcal/100g) | Carboidratos (g/100g) | Proteínas (g/100g) | Gorduras Totais (g/100g) | Fibras (g/100g) | Açúcares (g/100g) | Sódio (mg/100g) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Pão de Forma Tradicional** | 50g (2 fatias) | 244 | 48,0 | 7,6 | 2,6 | 2,6 | 3,2 | 400 |

---

## Como Importar os Dados

Criei um arquivo de seed chamado `alimentos_industrializados_brasil.json` dentro da pasta `scripts/import-foods/seeds/`. Ele segue exatamente a tipagem `ImportPayload` que você definiu em `types.ts`.

Para importar estes dados para o seu banco, você pode criar um script semelhante ao `seed_common_brazil_foods.ts`, mas apontando para este novo arquivo JSON.

## Referências

[1] [Site Oficial Quaker - Tabela Nutricional Aveias](https://www.br.joypepsico.com/quaker/produtos)
[2] [Site Oficial Nescau - Tabela Nutricional](https://www.nescau.com.br/produtos/achocolatado-po/nescau)
[3] [Site Oficial Nestlé Professional - Leite Condensado Moça](https://www.nestleprofessional.com.br/moca/lata-de-leite-condensado-moca-26kg)
[4] [Loja FamilyNes (Nestlé) - Leite Ninho Integral](https://www.lojafamilynes.com.br/ninho-integral-lata-380-gr)
[5] [Site Oficial Maizena - Amido de Milho](https://www.maizena.com.br/p/amido-de-milho-maizena.html/07894000010014)
[6] [Site Oficial Marilan - Biscoito Cream Cracker](https://www.grupomarilan.com.br/produto/marilan/biscoitos/biscoito-marilan-cream-cracker-manteiga-300g-p149)
[7] [Open Food Facts - Iogurte Natural Danone](https://br.openfoodfacts.org/produto/7891025120230/iogurte-integral-natural-danone-copo-160g)
[8] [Varejistas / Rótulo Oficial - Pão Pullman Tradicional](https://www.sondadelivery.com.br/faco/produto/pao-de-forma-tradicional-pullman-480g/1000010349)
