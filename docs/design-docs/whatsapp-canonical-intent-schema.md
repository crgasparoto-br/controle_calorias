# Design técnico: contrato canônico de intenções do WhatsApp

## Responsabilidade

A subissue #411 define o contrato estruturado que deve existir antes de qualquer roteamento funcional amplo do WhatsApp. Esse contrato fica em `server/modules/whatsapp/canonicalIntentSchema.ts` e é a referência versionada para que regras determinísticas, LLM estruturado, validação de backend, auditoria e ferramentas usem a mesma taxonomia.

Esta entrega não substitui o executor atual de intenções simples. Ela cria o contrato canônico que a #398 deve consumir no roteador e que as issues #412, #424, #436, #420, #421, #422 e #419 podem ampliar sem duplicar classificação.

## Versão

Schema atual: `whatsapp-intent-output/v1`.

Regras de evolução:

- adicionar campos opcionais é compatível;
- remover ou renomear campos exige nova versão;
- alterar significado de intenção exige nova versão ou migração documentada;
- novas intenções devem entrar na lista controlada e receber fixture de validação;
- consumidores devem rejeitar payload sem `schema_version` conhecida.

## Taxonomia

A lista controlada cobre:

- registro, adição, correção, troca e exclusão de alimentos/refeições;
- soma e cálculo de quantidades;
- ação composta com múltiplas ações ordenadas;
- resumo, relatório, gráfico, sugestão e histórico;
- perguntas sobre meta, evolução, qualidade alimentar, alimento, saúde/dieta, questão médica sensível e possível urgência;
- análise de imagem, extração de rótulo e mídia ambígua;
- interação profissional-paciente, sugestões profissionais e aceite/recusa/ajuste pelo paciente;
- confirmação, seleção de opção, esclarecimento e cancelamento de pendência;
- mensagem ambígua e mensagem não relacionada.

## Campos cobertos

O schema representa:

- entrada original, normalizada, transcrição e contexto de mídia;
- ator, alvo, profissional, contexto pendente e proposta pendente;
- confiança, nível de segurança, nível de autonomia e motivo da autonomia;
- período solicitado, expressão temporal, fuso usado, data resolvida, intervalo de horário e refeição alvo;
- itens alimentares extraídos, cálculos, fonte recomendada e opções de esclarecimento;
- múltiplas ações com ordem, alvo, dependências, entidade, autonomia, confirmação e validação individual;
- avisos, motivo de ambiguidade, estratégia de processamento e metadados opcionais.

## Invariantes

- Conteúdo ambíguo ou desconhecido possui representação explícita e não cai automaticamente no parser alimentar.
- Relatório, gráfico, resumo, sugestão e pergunta possuem intenções próprias.
- Perguntas médicas sensíveis e possíveis urgências não são alimento e podem ser bloqueadas pela autonomia.
- Mídia e transcrição carregam modalidade e contexto antes de qualquer roteamento alimentar.
- Datas relativas carregam o fuso horário usado e a data resolvida; não há fuso global fixo no contrato.
- Ações sensíveis carregam autonomia explícita para a validação decidir entre execução, confirmação, revisão ou bloqueio.
- `acao_composta` exige ao menos duas ações extraídas.
- `mensagem_ambigua` exige `ambiguity_reason`.
- `autonomy_level = bloqueado` exige `safety_level = bloqueado`.

## Fixtures de validação

`server/modules/whatsapp/canonicalIntentSchema.test.ts` cobre:

- taxonomia controlada e sem duplicidade;
- registro alimentar simples;
- pedido de relatório sem alimento;
- imagem com legenda e rótulo extraído;
- data relativa com fuso e data resolvida;
- múltiplas ações ordenadas;
- possível urgência de saúde bloqueada;
- interação profissional-paciente vinculada a pendência;
- rejeição de intenção inválida e mensagem ambígua incompleta.

## Relação com a camada atual

O interpretador atual segue usando `intentSchema.ts` para as ações já implementadas em #437/#429/#438. A migração para consumir o contrato canônico deve acontecer na #398, quando o roteador de intenção for implementado. Até lá, este contrato funciona como fonte de verdade para novas classificações e impede que cada issue crie uma taxonomia paralela.
