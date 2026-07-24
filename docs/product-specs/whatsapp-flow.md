# Especificação de produto: fluxo WhatsApp

## Contrato de resposta da epic #779

- Cada inbound produz no máximo uma resposta funcional lógica; texto, CTA e mídia auxiliar podem formar uma sequência física única.
- A resposta funcional é enviada apenas pelo transporte central e persistida uma vez no lifecycle. Acknowledgements não contam como resposta e só aparecem quando mídia ultrapassa o limiar de processamento.
- Reentregas não repetem mutações. Se o domínio foi alterado e a entrega falhou, a resposta é reconstruída pelos vínculos persistidos.
- Água e alimento na mesma entrada são consolidados na resposta final. Imagem anotada é mídia auxiliar e sua falha não cria outra resposta funcional.
- Perguntas livres à IA começam com `/`; sem `/`, a mensagem segue o roteamento de registros, consultas e alterações.
- Resumos usam somente `Meta`, `Exercícios`, `Consumo`, saldo calórico e macros `P`/`C`/`G`, com metas e totais fornecidos pelo domínio.

### Progresso nutricional nas respostas

As respostas de registro, consolidação e alteração de refeição e os resumos de período usam o mesmo contrato de progresso nutricional:

- `Consumo` apresenta somente o total consumido;
- o saldo calórico aparece em linha própria como `Superávit`, `Déficit` ou `Equilíbrio`;
- a diferença calórica é `consumo - meta calórica efetiva`;
- o percentual calórico é `((consumo - meta efetiva) / meta efetiva) × 100`, arredondado para número inteiro;
- a diferença em kcal é exibida em módulo; o percentual usa sinal positivo no superávit, negativo no déficit e `0%` no equilíbrio;
- classificação, diferença e percentual usam a mesma precisão dos números exibidos, evitando mensagens como `Superávit: 0 kcal`;
- respostas de refeição preservam calorias inteiras no bloco de progresso; resumos podem exibir até uma casa decimal;
- proteína, carboidratos e gorduras mostram consumo, diferença em gramas e diferença percentual sobre a meta do macro;
- somente a meta calórica pode ser ajustada por exercícios; metas de macros vêm da versão de meta aplicada ao dia e não são ajustadas por exercício;
- quando uma meta estiver ausente, inválida ou igual a zero, o formatter não inventa valores nem divide por zero;
- em períodos com vários dias, metas e consumos são consolidados pelo domínio dentro do mesmo intervalo e timezone; a meta atual não é multiplicada pelo número de dias.

## Objetivo

Oferecer registro conversacional de refeições usando um único número oficial da solução e identificando o usuário final pelo telefone de origem da mensagem.

## Regras de produto

- `WHATSAPP_PHONE_NUMBER_ID` representa o canal oficial de envio e recebimento; não é escolhido por usuário.
- O telefone do usuário final vem do campo `from` do payload da Meta.
- O sistema deve responder sempre ao telefone de origem usando o número oficial configurado.
- O usuário não deve cadastrar o número oficial como se fosse seu telefone pessoal.
- O WhatsApp é o canal principal para registrar refeições, água e exercícios.
- A saudação inicial pelo WhatsApp é uma mensagem operacional/de boas-vindas e não deve exigir aceite explícito separado na tela de perfil.
- Ao salvar perfil com telefone de WhatsApp ou pedir envio de saudação, o fluxo operacional necessário para essa mensagem é considerado concedido, sem habilitar marketing ou disparos recorrentes.
- Na aba Perfil de Configurações, usuários sem perfil profissional ativo não devem ver o bloco Saudação pelo WhatsApp; para esse fluxo, a saudação operacional permanece autorizada e oculta sem exigir ação manual.
- Usuários com perfil profissional ativo podem ver o bloco de Saudação pelo WhatsApp quando houver telefone vinculado ou telefone pronto para vinculação, mantendo controle explícito do envio quando necessário.
- O fuso horário do perfil deve ser usado como referência para interpretar datas e horários do usuário; quando ausente, o padrão é `America/Sao_Paulo` (UTC-03:00 - Brasília/São Paulo).
- Respostas devem listar alimentos, porções, macros, calorias e horário em formato legível.
- Mensagens de texto devem corrigir unidades prováveis quando houver quantidade numérica e contexto seguro, por exemplo `300mo água` como `300 ml de água`.
- Conversões entre massa e volume só devem acontecer quando houver densidade confiável para o alimento ou bebida; alimentos sólidos sem densidade não devem ser convertidos automaticamente para volume.
- Quando uma medida for convertida, a resposta ao usuário deve deixar clara a medida interpretada, por exemplo usando a porção convertida na confirmação.
- Após registrar uma refeição pelo WhatsApp, a resposta pode incluir um link temporário de edição rápida para corrigir alimentos, quantidades ou unidades da refeição recém-criada.
- Imagem com alimento identificado, mas sem porção segura, não cria refeição: abre clarificação persistente de quantidade, preserva todos os itens identificados e conclui as porções pendentes em sequência antes de persistir.
- A correção `O último alimento é ...` sem quantidade abre uma pendência compatível; uma resposta posterior como `30g` conclui a substituição pelo processamento nutricional canônico e envia o resumo recalculado.
- Preparações com complemento calórico explícito, como `café com açúcar`, não podem usar referência incompatível de ausência do ingrediente.
- Quando a quantidade do açúcar estiver ausente e não houver estimativa nutricional utilizável, registro, adição e substituição abrem a interação canônica `food_clarification.quantity` antes de qualquer mutação.
- Essa pendência preserva texto original e sanitizado, quantidade/unidade já reconhecida para o café, componente ausente, operação pendente, referência segura à refeição/item quando aplicável, usuário, inbound correlacionado, versão, TTL e ações permitidas.
- A resposta de quantidade reivindica a pendência atomicamente, revalida o alvo e conclui no máximo uma mutação. Reentrega, retry, callback ou áudio transcrito não podem duplicar café, açúcar, item, refeição ou resposta funcional.
- Falha ao persistir a pendência impede a pergunta; falha após possível mutação exige verificação do estado e não recria automaticamente a operação.
- Ao salvar pelo link de edição rápida, alimentos alterados sem referência de catálogo são reprocessados pelo backend antes da persistência, e uma nova confirmação é enviada ao WhatsApp a partir do estado salvo.
- Correções textuais no formato `não é X, é Y` devem ser interpretadas como correção de alimento antes de qualquer intenção de hidratação, mesmo quando `X` for água.
- O link de edição rápida deve usar token opaco, expirar em janela curta e não expor IDs internos de usuário ou refeição.
- Se a geração do link de edição rápida falhar, o registro da refeição e a resposta nutricional principal devem continuar funcionando.
- Recursos visuais auxiliares são opcionais. Falha nesse apoio não pode bloquear registro nem confirmação da refeição.
- A imagem anotada recebida após a análise de uma foto é uma preferência individual, desabilitada por padrão e configurável somente em **Configurações > Perfil**. Ausência, valor inválido ou falha de leitura mantém o recurso desabilitado.
- Quando a preferência estiver desabilitada, o sistema não gera, persiste nem envia a imagem anotada; a foto original, a análise nutricional, o registro e a resposta textual seguem normalmente.
- Pedidos naturais de orientação alimentar devem responder com sugestão educativa e não devem criar refeição automaticamente.
- Mensagens naturais de texto devem passar por uma camada de interpretação estruturada antes do fallback genérico de refeição.
- O interpretador estruturado pode usar LLM, mas o LLM só pode retornar intenção JSON validada; a execução continua controlada pelo backend.
- Mensagens de consulta como `refeições registradas` não devem cair na resposta de alimento incompleto.
- Quando o usuário informar alimentos junto de uma refeição válida ainda inexistente, o backend pode criar a refeição automaticamente se a intenção validada permitir `createIfMissing`.
- Envios de imagem e áudio pelo WhatsApp devem tentar usar o contexto ativo e a refeição lógica compatível do mesmo dia antes de criar um novo bloco de refeição.
- A mensagem inbound deve permanecer única pelo `message.id` da Meta; depois do download ou da transcrição, a mesma entrada persistida deve ser enriquecida com transcrição sanitizada e referência opaca de mídia, sem criar outro turno.
- Falha ao enriquecer o contexto persistente não pode bloquear o processamento nutricional já possível; o sistema deve seguir com o fallback seguro e registrar somente metadados operacionais.
- O horário da mensagem deve permanecer como metadado para exibição, ordenação, auditoria e interpretação temporal, mas não deve ser usado sozinho como chave de identidade ou agrupamento da refeição.
- Comandos posteriores, como ajustes e exclusões por alimento, devem procurar primeiro no contexto lógico seguro do dia/refeição, não apenas no último bloco criado pela última mensagem.
- Quando o usuário informar nome específico de produto, marca, linha, versão ou tipo/qualificador em texto, o registro exibido deve preservar esse nome sempre que ele for compatível com a referência nutricional usada internamente.
- Marca e tipo/qualificador informados no texto devem participar da busca da referência nutricional. A ordem de preferência é: alimento + marca + tipo, alimento + marca, alimento + tipo e, por último, alimento genérico quando não houver match mais específico confiável.

## Entradas suportadas

| Tipo   | Comportamento esperado                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------- |
| Texto  | Processar descrição livre da refeição ou responder intenções de texto, incluindo orientação alimentar |
| Imagem | Analisar alimento visível e gerar apoio visual opcional quando disponível                             |
| Áudio  | Transcrever, processar e preservar apenas o necessário                                                |

## Critérios de aceite

- Webhook valida token e payload.
- Mensagem inbound encontra ou solicita vínculo com usuário interno.
- Erros de configuração de token/número são explícitos para operação, mas não vazam segredo.
- Simulação inbound continua disponível para testes operacionais.
- O perfil pode salvar telefone e disparar saudação inicial sem checkbox de autorização explícita separado.
- Usuário comum sem perfil profissional ativo não visualiza o bloco Saudação pelo WhatsApp na aba Perfil de Configurações.
- As perguntas internas da saudação ficam autorizadas e ocultas para usuário comum, sem exigir ação manual antes de salvar perfil ou telefone.
- Usuário com perfil profissional ativo continua vendo o bloco de saudação apenas quando há contexto de telefone para envio.
- Usuários sem fuso salvo usam `America/Sao_Paulo` como padrão.
- O fuso selecionado no perfil permanece salvo e fica disponível para fluxos que dependem de data/hora.
- Mensagens com erro provável de unidade, como `300mo água`, são normalizadas quando a correção for segura pelo contexto.
- Medidas massa-volume usam densidade confiável quando disponível, por exemplo leite integral informado em gramas convertido para volume aproximado.
- Alimentos sólidos sem densidade confiável não são convertidos automaticamente de gramas para mililitros.
- Pedidos como `O que posso comer no jantar?` respondem pelo WhatsApp sem cair no fallback de registro de refeição.
- Correções como `Não é água é pão de cenoura` não devem cair no fluxo de água sem quantidade; devem gerar correção ou novo rascunho com o alimento informado.
- Texto comum de refeição continua disponível para inferência nutricional e registro conversacional.
- Refeições registradas pelo WhatsApp podem retornar link de edição rápida associado somente à refeição criada.
- Alimento identificado por imagem sem quantidade permanece pendente e não é persistido até uma resposta explícita de peso, volume ou porção.
- Correção do último alimento em duas mensagens preserva contexto, substitui somente o item revalidado e confirma macros do estado recarregado.
- Café com açúcar nunca usa slug, nome canônico ou composição de `cafe-sem-acucar`.
- Quantidade explícita de açúcar participa dos totais uma única vez; sem quantidade e sem estimativa utilizável, nenhuma refeição ou item é alterado antes da clarificação persistente.
- Registro, adição e substituição preservam o contexto da operação, retomam somente a pendência ativa e respondem com macros do estado recarregado.
- Resposta inválida mantém a pendência; pendência expirada, consumida ou reentregue não pode produzir nova mutação silenciosa.
- Edição rápida bem-sucedida envia uma nova confirmação ao WhatsApp sem expor falhas de SQL quando a notificação não puder ser entregue.
- Token inválido ou expirado deve exibir mensagem amigável na tela web de edição rápida.
- Falha de visual auxiliar não bloqueia o fluxo conversacional principal.
- Somente usuários que habilitaram explicitamente a preferência recebem a imagem anotada; a escolha permanece isolada por usuário e não altera o onboarding inicial.
- Payload inválido do interpretador LLM não executa ação e cai no classificador determinístico/fallback seguro.
- Baixa confiança ou ambiguidade gera pergunta contextual antes de alterar dados.
- Casos reais como troca de alimento, inclusão em refeição inexistente e consulta de refeições registradas ficam cobertos por testes de regressão.
- Imagem ou áudio enviado após uma refeição compatível no mesmo dia não cria novo bloco apenas porque chegou em outro horário; o conteúdo deve ser consolidado ou associado à refeição lógica segura.
- Imagem persistida e áudio transcrito enriquecem a mesma mensagem inbound capturada pelo webhook, mantendo uma única chave idempotente e sem duplicar turno, resposta ou registro de domínio.
- Exclusão por alimento, como `Excluir o chocolate`, busca candidatos no contexto lógico do dia/refeição e pede confirmação quando houver ambiguidade.
- Nome específico informado pelo usuário, como produto, marca ou tipo/qualificador, é preservado na exibição mesmo quando a referência nutricional/canônica usada internamente for genérica.
- Marca e tipo/qualificador informados no texto influenciam o match nutricional antes do fallback para alimento genérico.

## Invariantes finais da epic #779

- Toda resposta funcional passa pelo contrato lógico e pelo delivery central; acknowledgement é operacional, cancelável e nunca substitui a resposta funcional.
- Valores de meta são calculados no domínio. Formatters não recalculam a regra da #756, não multiplicam a meta atual por dias e não transformam ausência em zero.
- Datas e períodos usam o timezone do perfil, com `America/Sao_Paulo` somente como fallback.
- Ambiguidades de ações estruturadas usam pendência persistente, callback opaco e revalidação do banco antes da mutação.
- Onboarding composto retoma apenas mensagens físicas ainda não entregues após falha parcial.
- Erros de mídia, conta não vinculada e indisponibilidade são sanitizados e não expõem provider, payload, telefone completo ou identificadores internos.
- O gate arquitetural impede novos payloads, envios e builders paralelos fora dos módulos autorizados.

## Regra temporal do dono dos dados

Todas as respostas e ações do WhatsApp usam o timezone efetivo do usuário vinculado ao telefone. A mesma mensagem deve produzir a mesma data lógica em texto, foto, áudio, botão/lista e pergunta iniciada por `/`. Alterar o timezone do perfil afeta operações futuras, sem regravar o histórico.

## Timezone e edição rápida

O WhatsApp interpreta datas relativas no timezone efetivo do usuário identificado pelo telefone. A edição rápida exibe e converte horários no timezone do dono do registro; o navegador não substitui essa configuração e o backend não confia em timezone enviado pelo cliente.
