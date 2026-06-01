# Design técnico: ingestão WhatsApp

## Responsabilidade

Receber payloads da Meta, identificar usuário por telefone de origem, processar conteúdo multimodal e responder pelo número oficial da solução.

## Componentes

- Webhook HTTP para validação e inbound.
- Serviço de WhatsApp em `server/modules/whatsapp/service.ts`.
- Schemas em `server/modules/whatsapp/schemas.ts`.
- Configuração por variáveis `WHATSAPP_*`.
- Persistência de vínculo em `whatsappConnections`.

## Invariantes

- O número oficial é configuração de ambiente, nunca dado do usuário final.
- O campo `from` identifica o contato do usuário final.
- Tokens e IDs de operação não podem aparecer em logs crus.
- Simulações devem usar dados controlados e não depender de chamadas externas reais.
- Imagens recebidas pelo WhatsApp devem ser baixadas pelo backend e enviadas inline para a inferência nutricional, sem depender de URL pública ou assinada do storage para a IA ler a mídia.
- A URL persistida da imagem deve continuar sendo a URL do storage, não a data URL inline usada apenas durante a inferência.

## Validação recomendada

- Testar texto, imagem e áudio mockados.
- Testar que imagem inbound é enviada inline para a IA e que apenas a URL do storage é persistida no rascunho/refeição.
- Testar token ausente, telefone oficial usado como telefone de usuário e vínculo inexistente.
- Testar que resposta outbound usa sempre `WHATSAPP_PHONE_NUMBER_ID`.
