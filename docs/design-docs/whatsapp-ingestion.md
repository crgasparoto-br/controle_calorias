# Design técnico: ingestão WhatsApp

## Responsabilidade

Receber payloads da Meta, identificar usuário por telefone de origem, processar conteúdo multimodal e responder pelo número oficial da solução.

## Componentes

- Webhook HTTP para validação e inbound.
- Serviço de WhatsApp em `server/modules/whatsapp/service.ts`.
- Interpretação de comandos de texto em `server/modules/whatsapp/intentActions.ts`.
- Wrapper do webhook real em `server/whatsappIntentWebhook.ts`, executado antes do fallback de inferência nutricional.
- Schemas em `server/modules/whatsapp/schemas.ts`.
- Configuração por variáveis `WHATSAPP_*`.
- Persistência de vínculo em `whatsappConnections`.

## Invariantes

- O número oficial é configuração de ambiente, nunca dado do usuário final.
- O campo `from` identifica o contato do usuário final.
- Tokens e IDs de operação não podem aparecer em logs crus.
- Simulações devem usar dados controlados e não depender de chamadas externas reais.
- Mensagens suportadas de texto, imagem e áudio devem ser marcadas como lidas no WhatsApp antes do processamento pesado.
- Mensagens suportadas de texto, imagem e áudio devem receber uma resposta inicial informando que o conteúdo foi recebido e está sendo processado, exceto quando um texto puro for interpretado como ação e receber resposta final própria antes da inferência.
- Apenas mensagens de texto puro, sem imagem e sem áudio, podem ser tratadas pelo interpretador de ações antes do acknowledgement e antes do fluxo nutricional.
- Áudios sem imagem podem ser transcritos e, depois da resposta inicial de processamento, a transcrição pode ser tratada pelo mesmo interpretador de ações antes da inferência nutricional.
- Captions de imagem continuam no caminho multimodal normal e não devem ser interceptadas como intenção, para não perder a análise visual da foto.
- Textos que descrevem apenas consumo de água com quantidade explícita devem atualizar hidratação, não criar refeição ou item alimentar.
- Textos de hidratação com data relativa, como `ontem` ou `anteontem`, devem registrar o consumo no dia interpretado em `America/Sao_Paulo`.
- Textos de hidratação sem quantidade explícita devem pedir esclarecimento, não criar refeição.
- Textos que pedem redução de gramas devem ajustar uma refeição existente quando houver contexto suficiente, preservando proporção nutricional do item ajustado.
- Quando o ajuste de gramas não citar alimento, o sistema pode usar o último item da refeição mais recente; quando citar alimento, deve buscar item compatível na última refeição.
- Quando o comando não tiver contexto suficiente, o sistema deve pedir esclarecimento em vez de criar ou alterar registro incorreto.
- Quando o interpretador de texto tratar a mensagem ou transcrição, o webhook real deve registrar evento de inferência com `origin: "whatsapp"`, responder com a mensagem interpretada e impedir que o mesmo conteúdo crie refeição por fallback.
- Respostas finais de refeição no WhatsApp devem listar alimentos com calorias, proteína, carboidratos e gorduras por item, além do total estimado da refeição.
- Falha ao marcar a mensagem como lida ou enviar a resposta inicial deve gerar aviso operacional, mas não deve bloquear o processamento principal.
- Falha ao enviar resposta de intenção interpretada deve gerar aviso operacional, mas não deve reprocessar a mensagem como refeição.
- Imagens recebidas pelo WhatsApp devem ser baixadas pelo backend e enviadas inline para a inferência nutricional, sem depender de URL pública ou assinada do storage para a IA ler a mídia.
- Quando uma refeição for registrada a partir de imagem, o WhatsApp pode enviar uma imagem auxiliar anotada com legendas dos alimentos, calorias e macronutrientes por item, baseada na foto original recebida.
- Falha ao gerar ou enviar a imagem auxiliar anotada deve gerar no máximo aviso operacional e não deve bloquear o registro da refeição nem a resposta textual com os macros.
- Áudios recebidos pelo WhatsApp devem ser baixados pelo backend e enviados inline para transcrição, sem depender de URL pública ou assinada do storage para o provider ler a mídia.
- A URL persistida da mídia deve continuar sendo a URL do storage quando o storage estiver disponível, não a data URL inline usada apenas durante inferência ou transcrição.
- Falha ao persistir mídia no storage deve gerar aviso operacional, mas não deve bloquear análise de imagem, transcrição de áudio ou registro de refeição quando a mídia já tiver sido baixada da Meta.
- Quando o processamento da mídia falhar, a resposta automática deve ser genérica e não deve expor token, URL assinada, telefone completo, conteúdo cru ou detalhe interno do provider.

## Validação recomendada

- Testar texto, imagem e áudio mockados.
- Testar que texto, imagem e áudio inbound são marcados como lidos e recebem resposta inicial de processamento quando seguem para o fluxo nutricional normal.
- Testar que texto como `250ml de água` registra consumo de água sem chamar inferência nutricional nem criar refeição.
- Testar que texto como `500 ml de água ontem` registra consumo de água no dia anterior em `America/Sao_Paulo`.
- Testar que texto como `adicionar água ontem` pede a quantidade antes de executar qualquer ação.
- Testar que texto como `reduzir 50 g do arroz` ajusta o item compatível da última refeição e recalcula macros proporcionalmente.
- Testar que texto como `diminuir 30 g` ajusta o último item da última refeição quando não há alimento explícito.
- Testar que mensagem de texto comum de refeição continua delegando para o fluxo normal de inferência nutricional.
- Testar que áudio transcrito como `500 ml de água ontem` registra hidratação sem chamar inferência nutricional nem criar refeição.
- Testar que caption de imagem com texto parecido com comando continua no fluxo multimodal normal.
- Testar que resposta final de refeição no WhatsApp lista os alimentos com calorias e macros por alimento, além dos totais estimados.
- Testar que imagem inbound é enviada inline para a IA e que apenas a URL do storage é persistida no rascunho/refeição quando o storage está disponível.
- Testar que imagem inbound pode gerar resposta visual anotada com a foto original, alimentos identificados, calorias e macros por item.
- Testar que falha ao gerar ou enviar a imagem anotada não impede o registro da refeição nem a resposta textual.
- Testar que áudio inbound é enviado inline para transcrição e que apenas a URL do storage é persistida no rascunho/refeição quando o storage está disponível.
- Testar que falha de leitura, confirmação inicial ou storage não bloqueia o processamento quando a mensagem é válida.
- Testar token ausente, telefone oficial usado como telefone de usuário e vínculo inexistente.
- Testar que resposta outbound usa sempre `WHATSAPP_PHONE_NUMBER_ID`.
