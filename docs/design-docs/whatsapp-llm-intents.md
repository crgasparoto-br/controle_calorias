# Design técnico: intents LLM do WhatsApp

## Responsabilidade

A camada de intents LLM interpreta mensagens textuais do WhatsApp que não foram resolvidas pelos comandos determinísticos já existentes. Ela deve responder consultas e correções contextuais quando houver confiança suficiente e manter o fallback nutricional normal para mensagens comuns de refeição.

## Configuração operacional

- `OPENAI_WHATSAPP_INTENT_ENABLED`: permite desligar a camada LLM com `false`, `0`, `no` ou `off`.
- `AI_WHATSAPP_INTENT_PROVIDER` e `AI_WHATSAPP_INTENT_MODEL`: selecionam provider e modelo como um par. Sem as variáveis novas, o resolvedor usa a compatibilidade do provider (`AI_VISION_PROVIDER`) e o modelo correspondente (`OPENAI_MODEL` ou `GEMINI_MODEL`).
- `AI_WHATSAPP_INTENT_TIMEOUT_MS`, `AI_WHATSAPP_INTENT_MAX_ATTEMPTS` e `AI_WHATSAPP_INTENT_FALLBACK_*`: configuram a política independente da capacidade; fallback permanece desabilitado por padrão.
- `OPENAI_WHATSAPP_INTENT_MODEL`, `OPENAI_TEXT_MODEL`, `OPENAI_WHATSAPP_INTENT_TIMEOUT_MS`, `OPENAI_WHATSAPP_INTENT_RETRIES` e `_ENABLED` permanecem temporariamente compatíveis. Para providers `openai`/`openai-compatible`, a precedência legada de modelo é `OPENAI_WHATSAPP_INTENT_MODEL` > `OPENAI_TEXT_MODEL` > modelo resolvido; essas variáveis nunca substituem o modelo Gemini.
- Sem variáveis novas ou legadas de timeout/tentativas, a capacidade preserva o baseline anterior à migração: timeout de 8 segundos e 1 retry, totalizando no máximo 2 chamadas primárias.

## Fluxo

1. O webhook real tenta primeiro os comandos determinísticos existentes, como hidratação, ajuste de gramas, relatórios e sugestões.
2. Se nenhum comando determinístico tratar a mensagem, a camada LLM recebe texto, data de recebimento e contexto seguro do usuário.
3. O interpretador exige JSON estruturado, valida o payload e retorna diagnóstico de origem, validação e motivo de fallback quando aplicável.
4. Intents com baixa confiança ou confirmação obrigatória respondem pedindo esclarecimento.
5. Mensagens comuns de refeição continuam no fallback nutricional para evitar que o LLM bloqueie registros válidos.

## Sugestões de refeição

Mensagens consultivas ou propositivas, como `sugira`, `proponha`, `monte`, `me indique`, `o que posso comer` ou `quero uma opção`, devem ser classificadas como `meal_suggestion` mesmo quando citarem alimentos, refeições ou horários. Essa intenção não é persistente: a resposta deve deixar claro que é uma sugestão e que nada foi registrado como consumo.

Quando a mensagem puder ser tanto registro quanto sugestão, como `almoço com frango e arroz`, o sistema deve pedir confirmação antes de qualquer fallback nutricional ou escrita de refeição.

## Fallback seguro

A camada contextual volta para a classificação determinística quando o LLM está desligado ou quando o executor comum termina sem resultado utilizável. Timeout, rede, rate limit, saída vazia, JSON inválido e payload inválido podem consumir as tentativas/fallback configurados. Autenticação, modelo inexistente, incompatibilidade, bloqueio de segurança, configuração inválida e erro desconhecido são terminais e não disparam segundo envio. Esses casos não devem impedir o WhatsApp de continuar operacional.

## Auditoria

Cada mensagem interpretada pela camada LLM gera um registro de auditoria em memória com:

- hash da mensagem, sem armazenar o texto cru;
- intenção, confiança e resumo do payload;
- status de validação;
- ação tomada;
- tipo de resposta;
- motivo de fallback ou código de erro quando existir.

A consulta permite filtrar por intenção, erro, baixa confiança e motivo de fallback. A trilha é limitada em memória para diagnóstico operacional sem criar persistência sensível nova.

## Validação recomendada

- Testar LLM habilitado, desligado por ambiente, falha de provider, JSON inválido e payload inválido.
- Testar baixa confiança com resposta de esclarecimento.
- Testar consulta contextual no webhook real antes do fallback nutricional.
- Testar que mensagem comum de refeição continua sendo delegada ao fluxo nutricional.
- Testar que pedidos de sugestão de refeição não criam refeição nem alimento consumido.
- Testar que mensagens ambíguas entre sugestão e registro pedem confirmação antes do fallback nutricional.
- Testar auditoria sem texto cru e com filtros por erro, baixa confiança, intenção e fallback.


## Fronteira de execução #922

`intentInterpreter.ts` usa `resolveCapabilityConfig("WHATSAPP_INTENT")` e `executeResolvedCapability`. O adapter recebe o `AbortSignal` da tentativa e a resposta passa por `domainTextResponse.ts`, que remove `raw` do SDK antes da validação Zod. Não existe loop local concorrente de timeout/retry. A compatibilidade do baseline legado é aplicada somente a `WHATSAPP_INTENT` antes da execução comum; outras capacidades mantêm os defaults globais do resolvedor.
