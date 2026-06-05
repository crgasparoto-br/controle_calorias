# Design técnico: orientação alimentar no WhatsApp

## Responsabilidade

Responder pedidos educativos de orientação alimentar recebidos pelo WhatsApp sem transformar esses textos em registro automático de refeição.

## Componentes

- `server/modules/whatsapp/foodAssistant.ts`: interpreta pedidos de orientação alimentar e monta respostas educativas curtas.
- `server/whatsappIntentWebhook.ts`: chama a orientação alimentar apenas para mensagens de texto puro que não foram tratadas por intenções mais específicas.
- `server/modules/whatsapp/service.ts`: mantém a simulação inbound alinhada ao comportamento do webhook real.

## Invariantes

- A orientação alimentar não cria, edita ou confirma refeições.
- O fallback de inferência nutricional continua recebendo descrições comuns de refeições, como `almocei arroz, feijão e frango`.
- Intenções específicas, como hidratação, ajuste de gramas, relatório e edição de refeição, têm prioridade sobre a orientação alimentar.
- Logs operacionais registram somente a intenção tratada, sem persistir o texto cru da mensagem.
- As respostas são educativas e práticas; não substituem orientação profissional individualizada.

## Validação recomendada

- Testar pedido natural como `O que posso comer no jantar?`.
- Testar pedido conversacional como `Me ajuda a escolher um lanche da tarde`.
- Testar que texto comum de refeição continua indo para o fluxo normal de inferência nutricional.
- Testar que o webhook real responde e não delega para criação de refeição quando a orientação alimentar trata a mensagem.
