# Esclarecimentos e seleção por opções no WhatsApp

## Contexto

A issue #425 padroniza como o WhatsApp pede esclarecimento quando há baixa confiança, múltiplas opções, mensagem ambígua ou pendência que exige uma resposta do usuário.

O objetivo é manter a conversa curta e previsível: o sistema apresenta opções numeradas, aceita número ou texto equivalente e bloqueia qualquer registro crítico enquanto a pendência estiver aberta.

## Contrato implementado

O módulo `server/modules/whatsapp/clarificationOptions.ts` define:

- `WhatsappClarificationOption`: opção com `id`, `label` e `value` opcional.
- `buildWhatsappClarificationPrompt`: monta pergunta com opções numeradas e instrução final.
- `parseWhatsappClarificationSelection`: interpreta respostas do usuário.

Formato padrão da resposta:

```text
Qual item devo usar?
1. Arroz no almoço
2. Arroz no jantar
Responda com o número da opção ou escreva cancelar.
```

## Respostas aceitas

A seleção aceita:

- número: `1`, `2`;
- número com texto: `opção 1`;
- ordinal: `a primeira`, `a segunda`, `o terceiro`, `última`;
- texto da opção: `arroz no jantar`;
- cancelamento: `cancelar`, `cancela`, `nenhuma`, `nenhum`, `não`, `n`.

Se a opção estiver fora da faixa, a pendência permanece ativa e o usuário recebe uma instrução curta para escolher entre as opções válidas ou cancelar.

## Integração com contexto

A camada `conversationContext` usa o parser padronizado para consumir pendências do tipo `selection`.

Quando uma intenção retorna `*_selection_needed`, o contexto tenta registrar as opções estruturadas enviadas em `data.options`. Se a origem ainda só enviar `optionCount`, a camada cria labels genéricos como `Opção 1`, mantendo compatibilidade.

## Integração com ajustes de registro

`recordAdjustmentIntent` agora usa o formato padronizado quando há múltiplos alvos possíveis. As opções carregam labels reais e metadados do alvo:

- refeição;
- índice do item;
- nome do item;
- label exibido ao usuário.

A seleção ainda não aplica a alteração final nesta issue. Ela apenas preserva a escolha com segurança para o fluxo contextual seguinte, sem cair no parser nutricional.

## Limites e próximos passos

- A fila de revisão completa fica para #414.
- A aplicação final de alterações selecionadas depende da evolução do fluxo de contexto/ação segura.
- #421 e #422 devem reaproveitar o mesmo contrato para datas relativas e múltiplas ações.
