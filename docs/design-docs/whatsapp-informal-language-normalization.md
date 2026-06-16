# Design técnico: normalização de linguagem informal do WhatsApp

## Responsabilidade

A subissue #427 define uma camada para normalizar gírias, abreviações, erros de digitação e regionalismos antes da interpretação nutricional.

O contrato fica em `server/modules/whatsapp/informalLanguageNormalizer.ts` e é consumido por `inboundNormalizer.ts`. Ele preserva o texto original e produz um texto normalizado para o roteador, além de registrar substituições, termos incertos e aliases candidatos.

## Saída

A normalização retorna:

- `originalText`: texto recebido, compacto e preservado;
- `normalizedText`: texto seguro para roteamento;
- `replacements`: lista de substituições aplicadas, com tipo, fonte e confiança;
- `uncertainTerms`: termos como `tiquinho`, `pratão` ou `punhado` que podem exigir quantidade;
- `candidateGlobalAliases`: aliases recorrentes ainda não revisados;
- `requiresClarification`;
- `clarificationQuestion`.

## Regras iniciais

Regras seguras são aplicadas diretamente, por exemplo:

- `pao` -> `pão`;
- `c` -> `com`;
- `2 fatia` -> `2 fatias`;
- `refri zero` -> `refrigerante zero`;
- `cafe lor` -> `café L'Or`;
- `miojo turma da monica` -> `miojo Turma da Monica`.

Termos informais de porção, como `tiquinho`, `punhado`, `pratão` e similares, são mantidos rastreáveis e podem exigir esclarecimento. Eles não viram quantidade exata automaticamente.

## Aliases

Aliases podem ser:

- `personal`: aplicado quando já pertence ao usuário e tem confiança suficiente;
- `reviewed_global`: aplicado quando já foi revisado globalmente;
- `global_candidate`: registrado como candidato, mas não aplicado automaticamente.

Essa separação evita promover conhecimento global sem revisão, auditoria e dataset de regressão.

## Integração

`inboundNormalizer.ts` usa o normalizador informal depois de montar o `routerText` com texto, legenda, transcrição e extração de mídia. Assim:

- o roteador recebe texto mais consistente;
- o texto original continua disponível;
- substituições ficam rastreáveis;
- inferências incertas pedem esclarecimento;
- aliases recorrentes podem alimentar revisão futura sem virar regra global automaticamente.

## Casos de teste

`server/modules/whatsapp/informalLanguageNormalizer.test.ts` cobre:

- falta de acento;
- abreviação comum;
- plural/singular em quantidade;
- marca incompleta;
- bebida zero informal;
- produto com marca regional;
- termo de porção incerto;
- alias pessoal revisado;
- alias global candidato;
- integração com `inboundNormalizer`.
