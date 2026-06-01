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
- Mensagens suportadas de texto, imagem e áudio devem ser marcadas como lidas no WhatsApp antes do processamento pesado.
- Mensagens suportadas de texto, imagem e áudio devem receber uma resposta inicial informando que o conteúdo foi recebido e está sendo processado.
- Textos que descrevem apenas consumo de água com quantidade explícita devem atualizar hidratação, não criar refeição ou item alimentar.
- Respostas finais de refeição no WhatsApp devem ser resumidas, com alimentos e calorias totais, sem listar proteína, carboidrato e gordura de cada item.
- Falha ao marcar a mensagem como lida ou enviar a resposta inicial deve gerar aviso operacional, mas não deve bloquear o processamento principal.
- Imagens recebidas pelo WhatsApp devem ser baixadas pelo backend e enviadas inline para a inferência nutricional, sem depender de URL pública ou assinada do storage para a IA ler a mídia.
- Áudios recebidos pelo WhatsApp devem ser baixados pelo backend e enviados inline para transcrição, sem depender de URL pública ou assinada do storage para o provider ler a mídia.
- A URL persistida da mídia deve continuar sendo a URL do storage quando o storage estiver disponível, não a data URL inline usada apenas durante inferência ou transcrição.
- Falha ao persistir mídia no storage deve gerar aviso operacional, mas não deve bloquear análise de imagem, transcrição de áudio ou registro de refeição quando a mídia já tiver sido baixada da Meta.
- Quando o processamento da mídia falhar, a resposta automática deve ser genérica e não deve expor token, URL assinada, telefone completo, conteúdo cru ou detalhe interno do provider.

## Validação recomendada

- Testar texto, imagem e áudio mockados.
- Testar que texto, imagem e áudio inbound são marcados como lidos e recebem resposta inicial de processamento.
- Testar que texto como `250ml de água` registra consumo de água sem chamar inferência nutricional nem criar refeição.
- Testar que resposta final de refeição no WhatsApp é resumida e não lista macros por alimento.
- Testar que imagem inbound é enviada inline para a IA e que apenas a URL do storage é persistida no rascunho/refeição quando o storage está disponível.
- Testar que áudio inbound é enviado inline para transcrição e que apenas a URL do storage é persistida no rascunho/refeição quando o storage está disponível.
- Testar que falha de leitura, confirmação inicial ou storage não bloqueia o processamento quando a mensagem é válida.
- Testar token ausente, telefone oficial usado como telefone de usuário e vínculo inexistente.
- Testar que resposta outbound usa sempre `WHATSAPP_PHONE_NUMBER_ID`.
