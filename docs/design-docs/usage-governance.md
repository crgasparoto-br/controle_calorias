# Governança interna de uso e economia da IA

Este documento define o contrato operacional implementado pela issue #897. Ele complementa `ai-observability-pricing.md` e `billing-foundation.md`; não cria uma fonte paralela de preço, assinatura ou entitlement.

## Objetivo

A plataforma precisa responder, sem persistir conteúdo conversacional livre em analytics, quanto a IA está sendo usada, quanto custa aproximadamente, onde retries/timeouts aumentam custo e quando um usuário deve ser limitado antes de uma nova chamada externa.

## Fontes canônicas

- Preço de provider/modelo/ferramenta continua exclusivamente em `server/_core/ai/pricingCatalog.ts`, incluindo versão, data efetiva e unidade de cobrança.
- Estado comercial, assinatura, cobertura profissional e `admin_override` continuam em billing.
- Eventos econômicos detalhados reutilizam `inferenceLogs` com `eventType=ai.inference_call`; não existe cópia do prompt, resposta, texto de conversa, áudio, imagem, URL, reasoning ou erro bruto.
- Reservas de quota reutilizam `inferenceLogs` com `eventType=ai.usage_reservation.<capability>` e contêm somente identificadores internos/referências opacas e metadados comerciais normalizados.

## Separação: plano, fonte, entitlement e allowance

Os conceitos não são intercambiáveis:

- **plano**: versão comercial contratada. Para um usuário com `admin_override`, a assinatura original continua existindo e seu `planCode` não é sobrescrito.
- **fonte de acesso**: razão efetiva retornada por billing, como `active_subscription`, `sponsored_by_professional` ou `admin_override`.
- **entitlement**: capacidade funcional concedida pelo acesso efetivo.
- **allowance**: quantidade operacional permitida na janela de quota. A allowance é derivada depois do acesso, podendo usar override por `planCode` ou entitlement sem modificar nenhum desses objetos.

Em cobertura profissional, o beneficiário continua sendo o dono da quota por usuário e `billedUserId` identifica o patrocinador para atribuição econômica. Em `admin_override`, `originalSubscriptionPlanCode` preserva a proveniência da assinatura quando houver.

## Quotas e proteção contra abuso

O executor comum de capacidades aplica a governança antes de criar ou chamar o adapter do provider quando existe atribuição de usuário no escopo da requisição.

A reserva é persistente e multi-instância: dentro de transação, o repositório bloqueia a linha do usuário (`FOR UPDATE`), conta reservas da capability na janela e só então persiste a próxima reserva. Isso evita que duas instâncias aprovem simultaneamente a mesma última vaga de quota.

Defaults por fonte de acesso, por janela de uma hora:

| Fonte | Chamadas |
|---|---:|
| `admin_override` | 240 |
| `active_subscription` | 180 |
| `sponsored_by_professional` | 120 |
| `active_trial` | 60 |
| `free_access` | 30 |
| `transition_access` | 30 |
| `read_only_access` / `no_access` | 0 |

Os defaults podem ser refinados sem espalhar regra pelo código:

- `AI_USAGE_PLAN_ALLOWANCES_JSON`: mapa JSON `{ "planCode": maxCalls }`;
- `AI_USAGE_ENTITLEMENT_ALLOWANCES_JSON`: mapa JSON `{ "entitlement": maxCalls }`.

Plan override tem precedência sobre entitlement override, que tem precedência sobre o default da fonte. Valores inválidos são ignorados. A razão de bloqueio exposta pelo domínio é `usage_limit_exceeded`; indisponibilidade da persistência produz `usage_governance_unavailable`, em vez de liberar silenciosamente uma chamada sem governança.

## Privacidade e granularidade

A telemetria permite agregação por usuário interno, capability/feature, origem, plano/fonte de acesso e janela temporal. Quando há referência de conversa, o valor recebido no fluxo é transformado em SHA-256 truncado antes de persistência e vira `conversationRef`; o identificador externo bruto não é mantido na telemetria econômica.

Campos permitidos incluem contadores, tokens normalizados, custo estimado, latência, outcome, retry/fallback, IDs internos, referência opaca de conversa, `planCode`, fonte de acesso, allowance e versão da política. Conteúdo livre do usuário continua proibido.

## Retenção

Versão da política: `2026-08-16.1`.

- Reservas de quota e eventos `usage_limit_exceeded`: **48 horas**. Finalidade: enforcement da janela, investigação curta de abuso/rate limit e suporte operacional.
- Eventos detalhados `ai.inference_call`: **90 dias**. Finalidade: custo aproximado, regressões, retries/timeouts, comparação de features e investigação operacional.
- Agregados de custo expostos pelo endpoint interno: **não são persistidos** nesta entrega; são calculados sob demanda dentro da janela pedida. Portanto não criam uma nova retenção além dos eventos detalhados.
- Dados de produto, conversa, mídia e billing seguem suas políticas próprias; a limpeza econômica não remove registros nutricionais ou comerciais.

O scheduler executa limpeza periódica e a política também é exportada no resultado analítico para tornar a retenção auditável.

## Visibilidade interna

`billing.adminUsageAnalytics` usa `adminProcedure`; não existe endpoint público equivalente. A consulta aceita janela máxima de 31 dias e filtro opcional por usuário.

A resposta contém:

- chamadas e tokens;
- custo estimado total;
- custo associado a retry/fallback/timeout;
- agrupamento por feature + plano + fonte de acesso;
- usuários que mais pressionam limites, incluindo quantidade de bloqueios.

Os valores são gerenciais/operacionais. Não são fatura, conciliação contábil nem cobrança ao cliente.

## Limitações deliberadas

- A allowance desta entrega mede chamadas por capability; não tenta converter todas as modalidades em uma única unidade financeira de cobrança ao cliente.
- O custo é estimado pelo catálogo versionado da observabilidade. Evento sem usage/preço suportado permanece sem estimativa em vez de inventar valor.
- O endpoint usa o conjunto de eventos detalhados disponível no período; dados já eliminados pela retenção não são reconstruídos.
