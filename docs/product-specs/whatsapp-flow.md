# Especificação de produto: fluxo WhatsApp

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
- O fuso horário do perfil deve ser usado como referência para interpretar datas e horários do usuário; quando ausente, o padrão é `America/Sao_Paulo` (UTC-03:00 - Brasília/São Paulo).
- Respostas devem listar alimentos, porções, macros, calorias e horário em formato legível.
- Após registrar uma refeição pelo WhatsApp, a resposta pode incluir um link temporário de edição rápida para corrigir alimentos, quantidades ou unidades da refeição recém-criada.
- Correções textuais no formato `não é X, é Y` devem ser interpretadas como correção de alimento antes de qualquer intenção de hidratação, mesmo quando `X` for água.
- O link de edição rápida deve usar token opaco, expirar em janela curta e não expor IDs internos de usuário ou refeição.
- Se a geração do link de edição rápida falhar, o registro da refeição e a resposta nutricional principal devem continuar funcionando.
- Recursos visuais auxiliares são opcionais. Falha nesse apoio não pode bloquear registro nem confirmação da refeição.
- Pedidos naturais de orientação alimentar devem responder com sugestão educativa e não devem criar refeição automaticamente.
- Mensagens naturais de texto devem passar por uma camada de interpretação estruturada antes do fallback genérico de refeição.
- O interpretador estruturado pode usar LLM, mas o LLM só pode retornar intenção JSON validada; a execução continua controlada pelo backend.
- Mensagens de consulta como `refeições registradas` não devem cair na resposta de alimento incompleto.
- Quando o usuário informar alimentos junto de uma refeição válida ainda inexistente, o backend pode criar a refeição automaticamente se a intenção validada permitir `createIfMissing`.

## Entradas suportadas

| Tipo | Comportamento esperado |
|---|---|
| Texto | Processar descrição livre da refeição ou responder intenções de texto, incluindo orientação alimentar |
| Imagem | Analisar alimento visível e gerar apoio visual opcional quando disponível |
| Áudio | Transcrever, processar e preservar apenas o necessário |

## Critérios de aceite

- Webhook valida token e payload.
- Mensagem inbound encontra ou solicita vínculo com usuário interno.
- Erros de configuração de token/número são explícitos para operação, mas não vazam segredo.
- Simulação inbound continua disponível para testes operacionais.
- O perfil pode salvar telefone e disparar saudação inicial sem checkbox de autorização explícita separado.
- Usuários sem fuso salvo usam `America/Sao_Paulo` como padrão.
- O fuso selecionado no perfil permanece salvo e fica disponível para fluxos que dependem de data/hora.
- Pedidos como `O que posso comer no jantar?` respondem pelo WhatsApp sem cair no fallback de registro de refeição.
- Correções como `Não é água é pão de cenoura` não devem cair no fluxo de água sem quantidade; devem gerar correção ou novo rascunho com o alimento informado.
- Texto comum de refeição continua disponível para inferência nutricional e registro conversacional.
- Refeições registradas pelo WhatsApp podem retornar link de edição rápida associado somente à refeição criada.
- Token inválido ou expirado deve exibir mensagem amigável na tela web de edição rápida.
- Falha de visual auxiliar não bloqueia o fluxo conversacional principal.
- Payload inválido do interpretador LLM não executa ação e cai no classificador determinístico/fallback seguro.
- Baixa confiança ou ambiguidade gera pergunta contextual antes de alterar dados.
- Casos reais como troca de alimento, inclusão em refeição inexistente e consulta de refeições registradas ficam cobertos por testes de regressão.
