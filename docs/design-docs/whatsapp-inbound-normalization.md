# Design técnico: normalização multimodal de entrada do WhatsApp

## Responsabilidade

A subissue #424 define uma etapa de normalização antes do roteador de intenção. Essa etapa recebe texto, áudio, imagem, imagem com legenda ou extrações de mídia e produz uma entrada comum para o pipeline de IA.

O contrato fica em `server/modules/whatsapp/inboundNormalizer.ts`. Ele não faz download de mídia nem chama serviços externos de transcrição ou visão; esses adaptadores devem preencher `transcribedText` ou `extractedText` antes da normalização. O objetivo desta entrega é padronizar o formato pré-roteador, as decisões iniciais e o resumo de auditoria.

## Entrada normalizada

A saída inclui:

- `inputModality`: texto, áudio, imagem ou imagem com legenda;
- `originalText`, `normalizedText`, `routerText` e `transcribedText`;
- `mediaContext`: id, mime type, legenda, texto de rótulo extraído, confiança e classificação;
- `intentHint`: intenção canônica inicial para o roteador;
- `sourceRecommendation`: catálogo, rótulo extraído, revisão manual ou nenhuma;
- `confidence`;
- `requiresClarification` e `clarificationQuestion`;
- `safetyCheck` do guard contra prompt injection;
- `auditSummary` com tipo de mídia, extração realizada, classificação, confiança e resposta.

## Classificações

- `none`: entrada textual sem mídia.
- `audio_transcript`: áudio com transcrição disponível.
- `food_image`: imagem com sinais de alimento/refeição na legenda ou extração.
- `nutrition_label`: imagem/legenda/extração com sinais de tabela nutricional, porção, kcal, macros ou ingredientes.
- `ambiguous_media`: mídia sem contexto suficiente.

## Regras principais

- Áudio só fica pronto para roteamento quando há transcrição.
- Imagem de alimento e rótulo nutricional seguem hints diferentes: `analisar_imagem_alimento` e `extrair_rotulo_nutricional`.
- Legenda entra no `routerText` como contexto explícito da imagem.
- Rótulo nutricional extraído recomenda `rotulo_extraido` como fonte rastreável.
- Mídia ambígua pede esclarecimento e não deve gerar registro alimentar inseguro.
- Texto, legenda, transcrição e extração passam pelo guard de conteúdo não confiável antes do roteador.

## Casos de teste

`server/modules/whatsapp/inboundNormalizer.test.ts` cobre:

- texto puro;
- áudio com transcrição;
- áudio sem transcrição;
- imagem de alimento com legenda;
- imagem de rótulo nutricional com extração;
- imagem sem legenda ou extração suficiente;
- tentativa de prompt injection em legenda antes do roteador.

## Integração esperada

A #398 deve consumir `routerText`, `inputModality`, `mediaContext`, `intentHint`, `sourceRecommendation`, `confidence` e `requiresClarification` ao implementar o roteador de intenção. A #410 deve persistir o `auditSummary` no histórico estruturado quando o armazenamento definitivo de mensagens for implementado.
