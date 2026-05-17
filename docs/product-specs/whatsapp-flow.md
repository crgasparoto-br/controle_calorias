# Especificação de produto: fluxo WhatsApp

## Objetivo

Oferecer registro conversacional de refeições usando um único número oficial da solução e identificando o usuário final pelo telefone de origem da mensagem.

## Regras de produto

- `WHATSAPP_PHONE_NUMBER_ID` representa o canal oficial de envio e recebimento; não é escolhido por usuário.
- O telefone do usuário final vem do campo `from` do payload da Meta.
- O sistema deve responder sempre ao telefone de origem usando o número oficial configurado.
- O usuário não deve cadastrar o número oficial como se fosse seu telefone pessoal.
- Respostas devem listar alimentos, porções, macros, calorias e horário em formato legível.
- Recursos visuais auxiliares são opcionais. Falha nesse apoio não pode bloquear registro nem confirmação da refeição.

## Entradas suportadas

| Tipo | Comportamento esperado |
|---|---|
| Texto | Processar descrição livre da refeição |
| Imagem | Analisar alimento visível e gerar apoio visual opcional quando disponível |
| Áudio | Transcrever, processar e preservar apenas o necessário |

## Critérios de aceite

- Webhook valida token e payload.
- Mensagem inbound encontra ou solicita vínculo com usuário interno.
- Erros de configuração de token/número são explícitos para operação, mas não vazam segredo.
- Simulação inbound continua disponível para testes operacionais.
- Falha de visual auxiliar não bloqueia o fluxo conversacional principal.
