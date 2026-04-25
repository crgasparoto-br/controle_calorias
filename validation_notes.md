# Validação funcional da plataforma

## Síntese da rodada de validação de 2026-04-20

A aplicação foi validada em ambiente ativo a partir da pré-visualização web e do canal oficial do **WhatsApp Business Cloud API**. Nesta rodada, além da navegação e dos fluxos principais da interface, também foi confirmada a operação multimodal real do webhook com **texto, imagem e áudio**, incluindo o recebimento das respostas automáticas no WhatsApp do usuário e a persistência da inferência pendente no banco após a aplicação da migração corretiva.

| Área validada | Evidência principal | Resultado |
|---|---|---|
| Registro web por texto | Inferência gerada, revisão exibida e refeição confirmada | Aprovado |
| Dashboard e relatórios | Totais diários e semanais refletidos após confirmação | Aprovado |
| Metas nutricionais | Valores persistidos exibidos e consistência energética calculada | Aprovado |
| Canais | Checklist operacional e status do WhatsApp exibidos | Aprovado |
| Administração | Indicadores operacionais e trilha de logs disponíveis | Aprovado |
| WhatsApp texto | Mensagem processada e resposta automática recebida | Aprovado |
| WhatsApp imagem | Mídia processada, rascunho criado e resposta automática recebida | Aprovado |
| WhatsApp áudio | Áudio transcrito, rascunho criado e resposta automática recebida | Aprovado |
| Persistência de inferências | Migração 0002 aplicada e reidratação pós-gravação validada | Aprovado |

## Fluxo web principal validado

Foi validado manualmente o fluxo de **registro textual de refeição** pela interface web. A navegação a partir do dashboard funcionou corretamente, o formulário aceitou a descrição `Arroz, feijão, frango grelhado e salada no almoço.`, a ação de inferência retornou a revisão com **4 itens identificados** e a confirmação salvou a refeição com sucesso. Em seguida, o dashboard passou a refletir o novo estado diário com **487 kcal** consumidas, atualização do histórico recente e evolução semanal coerente com os dados persistidos.

## Validação das páginas analíticas e operacionais

A página de **Metas nutricionais** carregou corretamente com os valores persistidos para o usuário, exibindo também a leitura de consistência energética esperada. A página de **Relatórios** apresentou indicadores semanais coerentes com o registro confirmado, reforçando que o dado salvo no fluxo transacional também abastece a camada analítica. Já a página de **Canais** exibiu o checklist operacional da integração WhatsApp e os parâmetros esperados para ativação, enquanto a página de **Administração** mostrou corretamente os contadores de uso e a trilha de eventos do backend multimodal.

## Homologação real do canal WhatsApp

A homologação real do canal foi concluída com sucesso com o número oficial configurado. Foram testadas entradas por **texto**, **imagem** e **áudio**, todas processadas com criação de rascunho e geração de resposta automática ao usuário. Houve confirmação explícita de recebimento das mensagens automáticas no WhatsApp, o que valida não apenas o processamento inbound, mas também o retorno outbound do fluxo operacional.

| Tipo de entrada | Evidência observada |
|---|---|
| Texto | Evento `whatsapp.message_processed`, criação de rascunho e resposta automática recebida |
| Imagem | Download da mídia, inferência criada, rascunho persistido e resposta automática recebida |
| Áudio | Upload da mídia, transcrição aplicada, inferência criada e resposta automática recebida |

## Correção da persistência de inferências no banco

Durante a validação operacional foi identificado o erro `Unknown column 'draftId' in 'field list'`, que indicava que a evolução de schema de `mealInferences` ainda não estava aplicada no banco real. A causa raiz era a ausência da migração `0002_purple_stature.sql` no ambiente de banco, embora o código já estivesse usando as colunas `draftId`, `sourceText`, `transcript` e `mediaJson`.

A correção foi executada com aplicação da migração no banco, tratamento dos registros legados para preenchimento de `draftId` antes da criação da restrição única e verificação posterior do schema. Depois disso, foi feita uma validação runtime usando a própria camada de aplicação para gerar uma nova inferência pendente e reidratá-la do banco com sucesso.

## Tratamento adicional para falhas de resposta do WhatsApp

O webhook foi refinado para registrar explicitamente o evento `whatsapp.reply_failed` quando o envio da resposta automática à Meta falhar. Com isso, o canal passa a manter visibilidade operacional também para erros outbound, reduzindo o risco de falhas silenciosas. A cobertura automatizada foi expandida para validar esse comportamento sem interromper a resposta HTTP do webhook.

## Situação atual e próximos acompanhamentos

A plataforma encontra-se apta para **primeira entrega formal**, com backend, frontend, persistência principal e canal multimodal do WhatsApp homologados. Permanecem como próximos acompanhamentos recomendados a ampliação do catálogo alimentar, o vínculo automático mais amplo entre números de telefone e usuários, o enriquecimento contínuo das notas de validação funcional e eventuais melhorias de observabilidade operacional.

## Síntese adicional da rodada de validação de 2026-04-25

Após a aplicação da migração `0004_married_solo.sql` e do script idempotente de compatibilização, a rota `/goals` voltou a carregar sem erro no ambiente em execução. A interface passou a exibir corretamente a nova organização com **meta geral da semana**, **exceções por dia da semana**, **soma planejada da semana** e **foco do dia atual**.

Na validação manual observada nesta rodada, o usuário consultado ainda não possuía exceções cadastradas, portanto a regra geral de **2200 kcal**, **160 g de proteínas**, **240 g de carboidratos** e **70 g de gorduras** foi aplicada uniformemente aos sete dias da semana. O resumo semanal apresentado na tela ficou consistente com esse cenário, exibindo **15400 kcal**, **1120 g de proteínas**, **1680 g de carboidratos** e **490 g de gorduras**.
