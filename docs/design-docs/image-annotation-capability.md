# Capacidade `IMAGE_ANNOTATION`

## Objetivo

`IMAGE_ANNOTATION` produz um artefato visual auxiliar sem alterar a análise nutricional, a foto original, a resposta textual ou a confirmação da refeição. O comportamento padrão é local e determinístico. A seleção de `MEAL_VISION` não participa da decisão de modo, provider ou modelo da anotação.

## Artefatos

- **Foto original**: mídia recebida e preservada sem sobrescrita.
- **Anotação da foto**: novo PNG derivado da foto original com uma camada determinística de texto e caixas.
- **Resumo visual**: eventual card independente que não contém a foto original. Não é anotação e não pode substituir silenciosamente a foto.

Original e derivado usam chaves de storage distintas. Uma falha ao criar ou armazenar o derivado nunca remove nem substitui o original.

## Modos

| Modo | Comportamento | Chamada externa |
|---|---|---|
| `local` | Auto-orienta uma cópia da foto e compõe um SVG com legenda nutricional. É o default. | Não |
| `external` | Resolve `IMAGE_ANNOTATION` e executa geração/edição pelo executor comum. | Sim, explicitamente configurada |
| `off` | Não produz imagem anotada. | Não |

Configuração especializada:

```env
AI_IMAGE_ANNOTATION_MODE=local
AI_IMAGE_ANNOTATION_EXTERNAL_FAILURE_MODE=off
```

`AI_IMAGE_ANNOTATION_EXTERNAL_FAILURE_MODE=local` autoriza a degradação funcional externa para local. Sem essa configuração explícita, falha externa encerra sem imagem anotada.

Provider, modelo, timeout, tentativas e fallback externo usam o contrato compartilhado:

```env
AI_IMAGE_ANNOTATION_PROVIDER=openai
AI_IMAGE_ANNOTATION_MODEL=gpt-image-1
AI_IMAGE_ANNOTATION_TIMEOUT_MS=30000
AI_IMAGE_ANNOTATION_MAX_ATTEMPTS=1
AI_IMAGE_ANNOTATION_FALLBACK_ENABLED=false
AI_IMAGE_ANNOTATION_FALLBACK_PROVIDER=openai
AI_IMAGE_ANNOTATION_FALLBACK_MODEL=gpt-image-1
AI_IMAGE_ANNOTATION_CROSS_PROVIDER_FALLBACK_ENABLED=false
```

`OPENAI_IMAGE_MODEL` permanece somente como compatibilidade legada do modelo OpenAI. Nenhuma variável de visão seleciona provider ou modelo para anotação. O provider OpenAI nativo aceita somente IDs explicitamente aprovados para geração e edição (`gpt-image-1`, `gpt-image-1-mini`, `gpt-image-1.5`, `gpt-image-1.5-2025-12-16` e `gpt-image-2`); novos aliases ou snapshots precisam ser adicionados deliberadamente à matriz. Um endpoint `openai-compatible` exige, além de `image_generation,image_edit` em `AI_OPENAI_COMPATIBLE_OPERATIONS`, o ID exato em `AI_OPENAI_COMPATIBLE_IMAGE_MODELS`.

## Renderização local

A implementação local:

1. valida MIME, base64, tamanho e limite de pixels antes de processar;
2. mantém um snapshot dos bytes originais e nunca grava sobre eles;
3. aplica orientação EXIF em uma cópia;
4. preserva largura, altura e proporção resultantes da orientação;
5. limita texto e quantidade de cards;
6. usa painéis translúcidos de alto contraste em área segura;
7. reduz a composição para um cabeçalho compacto em imagens pequenas;
8. cria um PNG separado com chave determinística derivada por hash;
9. mantém o buffer disponível quando o upload do derivado falhar.

O caminho local não reconstrói, completa, remove ou adiciona alimentos. Ele somente compõe uma camada SVG sobre a cópia da foto.

## Execução externa e fallback

Somente o modo `external` chama `resolveCapabilityConfig("IMAGE_ANNOTATION")` e `executeResolvedCapability`.

- Provider, operações e compatibilidade do modelo são validados antes da criação do adapter; configuração incompatível não envia a foto.
- Uma tentativa do executor realiza exatamente uma chamada `createImageGeneration`.
- Base64, MIME e limite de tamanho do resultado são validados dentro da tentativa governada; saída inválida é `invalid_payload` e pode consumir somente os retries/fallback previstos pela política central.
- O request externo inclui a foto original validada para edição, nunca somente uma URL sem bytes vinculados.
- O executor controla timeout, retries e no máximo uma chamada de fallback.
- Fallback externo permanece desabilitado por padrão.
- Provider diferente exige a flag cross-provider específica e continua bloqueado em produção até a promoção da issue #927.
- O callback não executa probe, enriquecimento, recuperação ou segunda chamada oculta.
- O resultado do SDK é reduzido a base64 e MIME antes de sair da fronteira do adapter; `raw` não chega ao domínio.

A transição `external -> local` é uma degradação funcional do consumidor. Ela não incrementa fallback de provider e só ocorre quando `AI_IMAGE_ANNOTATION_EXTERNAL_FAILURE_MODE=local`.

## Falhas e continuidade

As seguintes falhas são não bloqueantes para a refeição:

- modo `off`;
- foto original ausente ou inválida;
- configuração externa indisponível;
- erro do provider após a política limitada;
- erro no Sharp/renderização local;
- erro de upload do derivado;
- erro de envio do derivado ao WhatsApp.

Em todos esses casos, o fluxo preserva a foto original, o resultado textual e o registro da refeição. Não é permitido gerar um cartão genérico e apresentá-lo como anotação.

## Segurança e privacidade

- `local` não envia foto, prompt ou dados nutricionais a provider de imagem.
- `external` representa novo envio da foto ao provider específico de `IMAGE_ANNOTATION`.
- A mudança de `MEAL_VISION` não autoriza nem redireciona esse segundo envio.
- Cross-provider exige opt-in específico, validação de privacidade/LGPD, benchmark e rollout da #927.
- Logs registram apenas códigos normalizados e estado funcional. Não registram foto, base64, URL assinada, prompt, refeição, resposta completa, segredo ou mensagem bruta do SDK.
- O derivado segue a mesma política de retenção, exportação e exclusão aplicada às mídias vinculadas à refeição; o original continua sendo um artefato independente.

## Observabilidade

O resultado interno distingue:

- `mode`: `local`, `external` ou `off`;
- `artifactKind`: `photo_annotation`;
- `degradation`: `none` ou `external_to_local`;
- `providerSource`: `primary`, `primary_retry` ou `fallback`, somente no modo externo;
- `attempts`, somente no modo externo;
- `skippedReason` sanitizado quando nenhum artefato é produzido.

O cartão-resumo legado não recebe `artifactKind=photo_annotation`.

## Testes discriminantes

- default local mesmo com `AI_VISION_PROVIDER`/`AI_MEAL_VISION_PROVIDER` apontando para outro provider;
- `local` e `off` sem criação de adapter externo;
- derivado separado, dimensões preservadas e bytes originais intactos;
- texto longo, markup escapado, imagem pequena e ausência de itens;
- input malformado rejeitado antes de Sharp/storage/provider;
- external com provider/modelo da capacidade;
- modelo nativo incompatível e modelo `openai-compatible` sem allowlist exata rejeitados antes da criação do adapter;
- uma tentativa igual a uma chamada outbound;
- fallback same-provider único;
- cross-provider sem flag não cria adapter de fallback;
- degradação externa para local somente com opt-in;
- falhas locais, externas, de upload e de envio sem impedir registro textual;
- logs e respostas sem conteúdo sensível.

## Smoke controlado com foto

O smoke hermético da issue usa uma foto sintética, o entrypoint produtivo `generateAnnotatedMealImage` e storage em memória. Ele não usa segredo nem chama provider externo:

```bash
pnpm smoke:issue-925
```

O comando falha quando o modo padrão deixa de ser local, o original é alterado, o derivado não é separado, as dimensões mudam ou ocorre mais de uma escrita do artefato. A saída contém somente hashes e metadados da fixture sintética.

## Rollout e rollback

O rollout de #925 mantém `local` como default. `external` não deve ser ativado em produção nem ter provider/modelo promovidos antes da avaliação de #927. Rollback operacional é feito por configuração:

```env
AI_IMAGE_ANNOTATION_MODE=local
AI_IMAGE_ANNOTATION_EXTERNAL_FAILURE_MODE=off
AI_IMAGE_ANNOTATION_FALLBACK_ENABLED=false
AI_IMAGE_ANNOTATION_CROSS_PROVIDER_FALLBACK_ENABLED=false
```
