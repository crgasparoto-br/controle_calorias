# Design técnico: assistência de IA na Área Profissional

## Objetivo

Entregar resumos, comparações, perguntas assistidas e rascunhos para o nutricionista sem criar uma segunda fonte de verdade, sem automatizar decisões clínicas e sem ampliar o acesso aos dados da pessoa acompanhada.

A implementação corresponde à issue #813 e reutiliza os contratos canônicos das fases anteriores da épica #803.

## Fontes canônicas

A assistência individual usa somente:

- `professionals.patientPeriodBundle`, com metas, aderência, macronutrientes, frequência de registros, água, exercícios, peso e indicadores agregados calculados pelo backend;
- `professionalRecord.operationalAlerts`, com os alertas objetivos e explicáveis da central de acompanhamento;
- o timezone efetivo da pessoa acompanhada.

Refeições, comentários, mensagens, nomes de alimentos, observações clínicas e outros textos crus não são enviados ao provedor de IA. O contexto é reduzido a agregados numéricos, tipos padronizados de alerta e limites do período.

## Modos assistidos

- **Resumo:** descreve fatos calculados do período e separa interpretações assistidas.
- **Comparação:** compara o período atual com uma janela anterior de mesma duração.
- **Pergunta:** responde somente quando os dados autorizados sustentam a resposta. Solicitações de diagnóstico, prescrição, medicamento ou tratamento são recusadas antes da chamada ao provedor.
- **Rascunho:** prepara texto revisável para orientação, lembrete, pedido de pesagem, pedido de registro, mensagem administrativa ou resumo de acompanhamento.

O período máximo é de 90 dias.

## Autorização e revogação

A autorização profissional é validada antes de consultar os contratos canônicos e novamente depois da geração. Se o vínculo for revogado, o perfil profissional for inativado ou o acesso deixar de existir durante a chamada, o resultado é descartado e não é registrado como geração concluída.

No frontend, a resposta é vinculada à combinação de paciente, período, modo e pergunta. Mudança de qualquer um desses itens invalida a resposta pendente e impede que um resultado atrasado apareça no contexto errado.

## Priorização

A lista de pacientes para revisão é determinística e não usa LLM. Ela agrupa os alertas abertos por paciente, aplica pesos por severidade operacional e usa quantidade e atualização dos alertas apenas como desempate.

A IA não cria classificação clínica, risco nutricional ou novo critério de prioridade.

## Rascunhos e mutações

A geração não altera metas, refeições, prontuário, alertas, orientações ou mensagens.

Um rascunho permanece apenas na tela até o nutricionista escolher **Salvar em Mensagens**. Essa ação reutiliza `professionalRecord.messages.create` com:

- origem `ai_suggested`;
- ação `save_draft`;
- chave idempotente;
- estado persistido `draft`.

O envio pela web ou WhatsApp continua exigindo uma segunda ação explícita na página de Mensagens.

## Saída estruturada e fallback

O provedor deve responder em schema estrito com:

- título e resumo;
- fatos;
- interpretações;
- dados ausentes;
- cautelas;
- rascunho opcional;
- aviso educacional obrigatório.

Timeout, indisponibilidade, resposta inválida ou falha de parsing ativam um fallback determinístico calculado sobre os mesmos agregados. O fallback nunca depende de texto gerado anteriormente e não envia conteúdo automaticamente.

## Privacidade, segurança e auditoria

- Prompts e respostas não são persistidos em histórico, logs ou analytics.
- O evento auditável registra somente ator, paciente autorizado, modo, data e identificador opaco da geração.
- O provedor não recebe identificadores de usuário, nome do paciente ou textos crus do acompanhamento.
- Conteúdo de contexto é tratado como dado não confiável, nunca como instrução.
- O aviso educacional informa que a saída não substitui diagnóstico, prescrição ou decisão clínica.

Essas regras complementam `docs/PRIVACY_LGPD.md`, `docs/SECURITY.md` e `docs/RELIABILITY.md` sem alterar seus contratos de retenção, segredo ou observabilidade.

## Falhas e comportamento degradado

- Falha da IA: retorna fallback determinístico.
- Falha do relatório canônico: nenhuma geração é produzida.
- Revogação durante a geração: resposta descartada.
- Ausência de dados: aparece explicitamente em `missingData`; zero não é apresentado como observação clínica.
- Mudança de paciente ou período: resultado anterior é removido.
- Falha ao salvar rascunho: o texto permanece editável na tela e não aparece como enviado.

## Testes obrigatórios

- minimização do contexto e ausência de textos crus no payload;
- resistência a instruções inseridas em conteúdo do paciente;
- fallback para erro, timeout e schema inválido;
- revogação entre a consulta e o retorno do provedor;
- bloqueio de diagnóstico e prescrição sem chamar o provedor;
- priorização derivada somente de alertas canônicos;
- confirmação explícita antes de persistir um rascunho;
- descarte de resposta atrasada após troca de paciente, período ou modo.
