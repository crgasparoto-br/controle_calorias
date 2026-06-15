# Design técnico: política de autonomia da IA no WhatsApp

## Responsabilidade

A subissue #436 define quando uma intenção interpretada pelo WhatsApp pode ser executada automaticamente, quando precisa de confirmação, quando deve ir para revisão e quando deve ser bloqueada.

A política fica em `server/modules/whatsapp/autonomyPolicy.ts` e usa a taxonomia canônica de `canonicalIntentSchema.ts`. Ela não substitui a validação técnica da #412, nem implementa o fluxo profissional-paciente completo da #419.

## Versão

Política atual: `whatsapp-autonomy-policy/v1`.

Toda decisão retorna:

- versão da política;
- intenção;
- confiança recebida;
- nível de autonomia aplicado;
- resultado operacional esperado;
- confiança mínima exigida;
- exigência de validação de backend;
- exigência de aceite explícito;
- exigência de revisão;
- motivo registrado.

## Níveis

- `automatico`: pode executar quando a confiança mínima foi atingida, o alvo está resolvido e a validação exigida passou.
- `requer_confirmacao`: deve pedir confirmação ou aceite explícito antes de alterar estado.
- `requer_revisao`: deve ir para revisão ou fluxo pendente antes de execução.
- `bloqueado`: não deve executar ação de domínio.

## Regras principais

- Registro ou adição alimentar simples podem ser automáticos somente com confiança alta e validação de backend.
- Correção, troca, exclusão e ação composta exigem confirmação explícita.
- Alteração de meta, plano alimentar e sugestões profissionais exigem revisão ou aceite explícito.
- Perguntas médicas sensíveis exigem revisão ou resposta limitada.
- Possível urgência de saúde é bloqueada para ação de domínio.
- Ambiguidade, confiança baixa, alvo não resolvido ou falta de validação rebaixam a decisão.
- Mensagem não relacionada e pedido de esclarecimento não executam ação de domínio.

## Integração esperada

O roteador da #398 deve avaliar a intenção canônica, aplicar esta política e gravar `autonomyLevel`, `confidence`, `reason` e resultado na auditoria. A validação de backend da #412 ainda decide se os dados estruturados podem ser persistidos.

As ferramentas da IA devem usar o nível de autonomia como uma entrada de autorização. Ferramentas persistentes continuam exigindo validação e idempotência.

## Casos de teste

`server/modules/whatsapp/autonomyPolicy.test.ts` cobre:

- uma regra para cada intenção canônica;
- registro simples automático apenas com validação suficiente;
- correção de alimento com confirmação;
- remoção de alimento com confirmação explícita;
- alteração de meta encaminhada para revisão;
- sugestão profissional encaminhada para revisão e aceite;
- possível urgência de saúde bloqueada;
- ação ambígua rebaixada para confirmação.
