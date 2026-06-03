# Design técnico: ingestão WhatsApp

## Responsabilidade

Receber payloads da Meta, identificar usuário por telefone de origem, processar conteúdo multimodal e responder pelo número oficial da solução.

## Componentes

- Webhook HTTP para validação e inbound.
- Serviço de WhatsApp em `server/modules/whatsapp/service.ts`.
- Interpretação de comandos de texto em `server/modules/whatsapp/intentActions.ts`.
- Formatação de respostas nutricionais em `server/modules/whatsapp/replyMessages.ts`.
- Wrapper do webhook real em `server/whatsappIntentWebhook.ts`, executado antes do fallback de inferência nutricional.
- Wrapper de imagens anotadas em `server/whatsappAnnotatedImageWebhook.ts`, responsável por devolver e persistir a imagem auxiliar gerada após a análise visual.
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
- Textos que adicionam café sem açúcar a uma refeição existente, como `Adicionar 3 xícaras de café sem açúcar a refeição café da manhã`, devem atualizar a refeição indicada e não criar uma nova refeição por fallback.
- Quando a refeição indicada para adicionar café não existir ou faltar quantidade/refeição, o sistema deve pedir esclarecimento antes de alterar qualquer registro.
- Pedidos de sugestão de lanche devem responder diretamente ao usuário com opções simples, sem criar refeição por fallback.
- Pedidos de resumo, relatório ou balanço devem exigir período explícito, aceitar períodos como `hoje`, `ontem`, `semana`, `mês`, `últimos 7 dias` ou intervalo `01/06 a 03/06`, e responder com totais do período.
- Relatórios por WhatsApp devem resumir quantidade de refeições, calorias e macronutrientes consumidos, além de comparação simples com a meta estimada do período quando a meta estiver disponível.
- Quando o comando não tiver contexto suficiente, o sistema deve pedir esclarecimento em vez de criar ou alterar registro incorreto.
- Quando o interpretador de texto tratar a mensagem ou transcrição, o webhook real deve registrar evento de inferência com `origin: "whatsapp"`, responder com a mensagem interpretada e impedir que o mesmo conteúdo crie refeição por fallback.
- Respostas finais de refeição no WhatsApp devem usar linguagem simples, sem títulos técnicos como `Alimentos e macros`, e devem listar alimentos, porções, calorias, proteína, carboidratos e gorduras por item.
- Respostas finais de refeição devem mostrar o total da refeição e, quando houver meta disponível, um resumo curto de meta diária com calorias consumidas, meta e quanto falta ou excedeu.
- Falha ao carregar a meta diária não deve bloquear o registro da refeição nem a resposta nutricional principal.
- Falha ao marcar a mensagem como lida ou enviar a resposta inicial deve gerar aviso operacional, mas não deve bloquear o processamento principal.
- Falha ao enviar resposta de intenção interpretada deve gerar aviso operacional, mas não deve reprocessar a mensagem como refeição.
- Imagens recebidas pelo WhatsApp devem ser baixadas pelo backend e enviadas inline para a inferência nutricional, sem depender de URL pública ou assinada do storage para a IA ler a mídia.
- Quando uma refeição for registrada a partir de imagem, o WhatsApp deve enviar uma imagem auxiliar anotada com legendas dos alimentos, calorias e macronutrientes por item, baseada na foto original recebida.
- A imagem auxiliar anotada gerada para uma refeição deve ser salva no storage e vinculada à mesma refeição em `mealMedia`, junto com a imagem original, para deixar claro quais alimentos foram identificados a partir daquela imagem.
- Falha ao gerar, persistir ou enviar a imagem auxiliar anotada deve gerar no máximo aviso operacional e não deve bloquear o registro da refeição nem a resposta textual com os macros.
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
- Testar que texto como `Adicionar 3 xícaras de café sem açúcar a refeição café da manhã` adiciona café à refeição indicada e não chama inferência nutricional.
- Testar que pedido para adicionar café sem refeição ou sem quantidade suficiente pede esclarecimento e não altera registros.
- Testar que texto como `Me dê uma sugestão para o lanche da tarde` retorna uma sugestão e não chama inferência nutricional.
- Testar que texto como `Me envie um resumo da semana` retorna relatório do período e não chama inferência nutricional.
- Testar que pedido de relatório sem período pede esclarecimento antes de executar qualquer ação.
- Testar que mensagem de texto comum de refeição continua delegando para o fluxo normal de inferência nutricional.
- Testar que áudio transcrito como `500 ml de água ontem` registra hidratação sem chamar inferência nutricional nem criar refeição.
- Testar que caption de imagem com texto parecido com comando continua no fluxo multimodal normal.
- Testar que resposta final de refeição no WhatsApp lista os alimentos com calorias e macros por alimento, além dos totais estimados.
- Testar que resposta final de imagem no WhatsApp usa o formato simplificado com `Itens`, `Total da refeição` e `Meta de hoje`.
- Testar que imagem inbound é enviada inline para a IA e que apenas a URL do storage é persistida no rascunho/refeição quando o storage está disponível.
- Testar que imagem inbound pode gerar resposta visual anotada com a foto original, alimentos identificados, calorias e macros por item.
- Testar que a imagem anotada gerada é vinculada à refeição em `mealMedia`, junto com a imagem original recebida pelo WhatsApp.
- Testar que falha ao gerar, persistir ou enviar a imagem anotada não impede o registro da refeição nem a resposta textual.
- Testar que áudio inbound é enviado inline para transcrição e que apenas a URL do storage é persistida no rascunho/refeição quando o storage está disponível.
- Testar que falha de leitura, confirmação inicial ou storage não bloqueia o processamento quando a mensagem é válida.
- Testar token ausente, telefone oficial usado como telefone de usuário e vínculo inexistente.
- Testar que resposta outbound usa sempre `WHATSAPP_PHONE_NUMBER_ID`.