# Design técnico: assistente alimentar no WhatsApp

## Responsabilidade

Responder pedidos educativos de orientação alimentar recebidos pelo WhatsApp sem transformar esses textos em registro automático de refeição.

## Componentes

- `server/modules/whatsapp/foodAssistant.ts`: interpreta pedidos de orientação alimentar e monta respostas educativas curtas.
- `server/whatsappIntentWebhook.ts`: chama o assistente apenas para mensagens de texto puro que não foram tratadas por intenções mais específicas.
- `server/modules/whatsapp/service.ts`: mantém a simulação inbound alinhada ao comportamento do webhook real.

## Invariantes

- O assistente alimentar não cria, edita ou confirma refeições.
- O fallback de inferência nutricional continua recebendo descrições comuns de refeições, como `almocei arroz, feijão e frango`.
- Intenções específicas, como hidratação, ajuste de gramas, relatório e edição de refeição, têm prioridade sobre o assistente alimentar.
- Logs operacionais registram somente a intenção tratada, sem persistir o texto cru da mensagem.
- As respostas são educativas e práticas; não substituem orientação profissional individualizada.

## Validação recomendada

- Testar pedido explícito como `Assistente alimentar, o que posso comer no jantar?`.
- Testar pedido conversacional como `Me ajuda a escolher um lanche da tarde`.
- Testar que texto comum de refeição continua indo para o fluxo normal de inferência nutricional.
- Testar que o webhook real responde e não delega para criação de refeição quando o assistente trata a mensagem.
