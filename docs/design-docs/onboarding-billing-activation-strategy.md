# Onboarding WhatsApp e ativação por billing

## Contexto

A issue #209 define o onboarding iniciado pelo WhatsApp como uma épica de planejamento. O primeiro contato por WhatsApp não deve criar uma conta completa automaticamente. O fluxo precisa criar um lead ou usuário pendente, direcionar a finalização para o site e só liberar o uso pleno após uma condição explícita de ativação.

A issue #215 trata da etapa de pagamento, trial ou ativação. Ela depende da issue #145, que define o módulo de billing/assinaturas com checkout externo, status local, webhooks idempotentes e provider interno.

## Decisão

Enquanto o módulo de billing da #145 não estiver implementado, o onboarding iniciado pelo WhatsApp não deve ativar usuários por pagamento.

A regra segura para a primeira entrega é:

1. WhatsApp desconhecido cria ou reutiliza um lead em estado `lead_whatsapp`.
2. Lead recebe link assinado, expirável e de uso único para finalizar cadastro no site.
3. Após dados obrigatórios e consentimentos, o registro passa para `pending_onboarding` ou estado equivalente.
4. Se billing ainda não estiver disponível, o usuário permanece pendente até ativação manual/admin ou regra explícita de trial definida em implementação própria.
5. Somente após ativação válida o telefone passa a operar como usuário `active` no WhatsApp.

## Regra de ativação quando billing existir

Quando a #145 disponibilizar billing, a ativação por pagamento deve seguir este fluxo:

```text
pending_onboarding
-> usuário escolhe plano no site
-> backend cria checkout externo pelo provider interno
-> registro passa para pending_payment
-> usuário paga no checkout hospedado
-> provider envia webhook validado pelo backend
-> webhook idempotente confirma pagamento
-> registro passa para active
-> WhatsApp envia mensagem operacional de boas-vindas, se houver consentimento aplicável
```

O retorno visual do checkout nunca deve ativar o usuário sozinho. Ele pode apenas informar que o pagamento está em processamento e orientar o usuário a aguardar confirmação.

## Estados recomendados

Os nomes finais podem ser adaptados à arquitetura existente, mas o fluxo deve preservar estas responsabilidades:

- `lead_whatsapp`: telefone conhecido pelo sistema, mas sem cadastro concluído.
- `pending_onboarding`: dados obrigatórios ainda incompletos ou aguardando aceite/consentimento.
- `pending_payment`: cadastro concluído, mas aguardando confirmação segura de pagamento.
- `active`: usuário pode registrar refeições, água, peso e comandos normais pelo WhatsApp.
- `activation_blocked`: estado opcional para falha, expiração, conflito de telefone ou pendência administrativa.

## Bloqueio de comandos alimentares

Enquanto o usuário não estiver `active`, o webhook do WhatsApp deve bloquear comandos alimentares. A resposta deve ser operacional e curta, por exemplo:

```text
*Cadastro pendente*

Para usar o Controle de Calorias pelo WhatsApp, finalize seu cadastro pelo link enviado.
```

Esse bloqueio deve acontecer antes do fallback nutricional, para evitar que uma mensagem de lead pendente seja interpretada como refeição.

## Dependência com #145

A #215 não deve implementar um checkout próprio nem confirmar pagamento sem o backend de billing.

A implementação de pagamento depende minimamente de:

- provider interno de billing;
- criação de checkout externo;
- persistência local de assinatura ou tentativa de pagamento;
- status `pending`/`active`/`failed` ou equivalentes;
- webhook validado e idempotente;
- registro de eventos recebidos;
- helper de acesso para consultar ativação/assinatura.

Sem esses elementos, a única ativação segura é manual/admin ou trial explicitamente implementado sem cobrança.

## Critérios para a #215 avançar para implementação

Antes de transformar a #215 em código de ativação por pagamento, devem estar definidos:

- provider inicial de pagamento;
- se haverá trial;
- se trial exige pagamento cadastrado;
- regra de ativação manual/admin;
- prazo de expiração do link de onboarding;
- prazo de recuperação de pagamento abandonado;
- mensagem operacional após ativação;
- política para telefone já vinculado a usuário ativo.

## Testes esperados

Quando a implementação funcional avançar, os testes mínimos devem cobrir:

- lead pendente não registra refeição pelo WhatsApp;
- link expirado, inválido ou reutilizado é rejeitado;
- checkout criado deixa usuário em `pending_payment`;
- retorno visual do checkout não ativa usuário;
- webhook confirmado ativa usuário;
- webhook duplicado não altera estado indevidamente;
- falha, expiração ou cancelamento mantém o usuário não ativo;
- usuário ativo volta a registrar normalmente pelo WhatsApp;
- mensagem de boas-vindas é enviada somente após ativação válida.

## Relação com issues

- Relaciona #209 como épica de onboarding via WhatsApp.
- Relaciona #215 como subissue de ativação/pagamento.
- Relaciona #145 como dependência obrigatória para pagamento real.
- Prepara #217, pois fixa os cenários que precisarão de cobertura automatizada.
