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

Antes da chamada ao provedor, todos os campos autorizados são convertidos em um catálogo de fontes com chaves estáveis. Esse catálogo é a única representação dos dados do acompanhamento enviada ao provedor. O catálogo inclui período, frequência, aderência, calorias, macros realizados e planejados, dias úteis, finais de semana, água, exercícios, peso, qualidade alimentar e alertas. Em comparações, o mesmo conjunto é produzido para o período anterior. Os alertas do período anterior são consultados com o próprio intervalo e timezone; ausência de alerta só é declarada depois dessa consulta, nunca inferida por uma lista vazia artificial.

Cada sinal informa também se está disponível. Sinais ausentes continuam visíveis no catálogo para conferência, mas não podem ser citados pelo resumo ou pelas interpretações. Uma referência inexistente ou indisponível invalida a resposta e aciona o fallback determinístico.

Os fatos calculados e a lista de dados ausentes são produzidos exclusivamente pelo backend canônico. Mesmo que o provedor devolva valores nesses campos, eles são substituídos antes da resposta chegar à interface.

## Modos assistidos

- **Resumo:** descreve fatos calculados do período e separa interpretações assistidas.
- **Comparação:** compara o período atual com uma janela anterior de mesma duração.
- **Pergunta:** aceita texto livre, preservando a capacidade de analisar perguntas não previstas. Perguntas analíticas reconhecidas podem usar o provedor completo; consultas objetivas sensíveis usam somente o backend; perguntas livres seguras usam o provedor apenas como classificador de foco estruturado e recebem resposta canônica citada; solicitações clínicas recebem limite explícito.
- **Rascunho:** prepara texto revisável para orientação, lembrete, pedido de pesagem, pedido de registro, mensagem administrativa ou resumo de acompanhamento.

O período máximo é de 90 dias inclusivos. Datas inexistentes no calendário, intervalos invertidos e períodos maiores que o limite são rejeitados antes da execução.

A experiência antiga `/professional/legacy` não executa mais o componente ou o fluxo de IA anterior; ela redireciona para os relatórios profissionais atuais. O contrato `nutrition.professionals.askPatientQuestion` foi desativado no schema para impedir chamadas diretas que não informem período e não passem pelas garantias de `professionalRecord.ai.generate`.

## Autorização e revogação

A autorização profissional é validada antes de consultar os contratos canônicos e novamente depois da geração. Se o vínculo for revogado, o perfil profissional for inativado ou o acesso deixar de existir durante a chamada, o resultado é descartado e não é registrado como geração concluída.

A priorização também exige perfil profissional ativo antes de consultar alertas. Um perfil inativado não recebe nomes, severidades ou pendências dos pacientes, mesmo que ainda exista autorização aprovada no banco.

No frontend, a resposta é vinculada à combinação de paciente, período, modo, tipo de rascunho e pergunta. Mudança de qualquer um desses itens invalida a resposta pendente de forma síncrona e impede que um resultado antigo ou atrasado apareça no contexto errado.

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

## Perguntas livres com foco estruturado

Perguntas são classificadas antes da geração:

- `provider_allowed`: perguntas analíticas reconhecidas e compostas pelo vocabulário objetivo autorizado podem usar a saída estruturada completa;
- `deterministic_only`: consultas objetivas sensíveis, como água, peso, macros ou exercícios, são respondidas diretamente pelo backend canônico sem enviar a pergunta ao provedor;
- `focus_classifier`: perguntas livres seguras não previstas usam uma chamada separada cujo schema aceita somente um foco conhecido (`overview`, `records`, `adherence`, `macros`, `water`, `exercise`, `weight`, `food_quality` ou `alerts`) ou `clinical_boundary`;
- `clinical_boundary`: comandos, diagnósticos, prescrições, decisões autônomas e perguntas sensíveis não analíticas recebem limite clínico sem geração livre.

O classificador de foco não recebe o catálogo do paciente e não pode devolver texto, explicação, valores ou fontes. Ele recebe apenas a pergunta com redação sensível removida e retorna um enum estrito. O backend associa esse foco ao sinal canônico correspondente, monta o título, resumo, fatos e interpretação e indica as chaves de fonte. Se o foco estiver indisponível, a resposta declara insuficiência e usa somente fontes disponíveis.

Se o classificador devolver `clinical_boundary`, a resposta apresenta o limite clínico. JSON inválido, timeout ou foco fora do enum acionam o fallback determinístico geral. Dessa forma, perguntas livres continuam assistidas por IA sem permitir que o modelo redija uma resposta clínica livre.

## Saída estruturada, segurança e fallback

A saída completa do provedor deve seguir schema estrito com:

- título e resumo;
- resumo e respectivas chaves de fonte;
- arrays reservados para fatos e fontes, substituídos pelo backend;
- interpretações e respectivas chaves de fonte;
- array reservado para dados ausentes, substituído pelo backend;
- cautelas;
- rascunho opcional;
- aviso educacional obrigatório.

A validação ocorre em quatro camadas:

1. JSON válido e compatível com o schema estrito;
2. referências limitadas às chaves presentes no catálogo enviado ao provedor;
3. rejeição de referências a sinais marcados como indisponíveis;
4. validação semântica por negação segura, aplicada antes da chamada e depois da resposta.

A classificação não depende apenas de listas de alimentos ou verbos conhecidos. Comandos com termos não previstos, como montar cardápio, distribuir frutas, apostar em saladas ou organizar a rotina, não alcançam a geração livre. Perguntas como `Seria interessante uma dieta cetogênica?` recebem limite clínico.

Todo texto controlado pelo provedor completo — título, resumo, interpretações, cautelas e rascunho — precisa usar exclusivamente um vocabulário factual autorizado. Palavras desconhecidas, linguagem persuasiva, comandos, qualificadores clínicos ou termos fora da lista segura invalidam a resposta inteira e acionam o fallback. Quando a frase contém metas, calorias, macros, água, peso ou exercícios, também precisa apresentar evidência explícita de registro, cálculo, realização, planejamento ou variação.

A tokenização usa propriedades Unicode para reconhecer letras e números de qualquer alfabeto. Uma cláusula sem palavras reconhecíveis ou contendo palavras em escrita não autorizada é rejeitada; portanto, texto em outro alfabeto não consegue contornar o vocabulário seguro por produzir uma lista vazia de tokens.

Os campos `facts`, `factSourceKeys` e `missingData` não dependem do texto do provedor: são sempre substituídos pelos valores canônicos do backend. Pontos e vírgulas entre dígitos são preservados para que valores como `1.800`, `2.000` e `93,3` não sejam divididos em cláusulas falsas.

Se qualquer camada falhar, a resposta do provedor é descartada integralmente. Timeout, indisponibilidade, resposta inválida, referência desconhecida ou indisponível, vocabulário não permitido e conteúdo clínico proibido ativam fallback determinístico calculado sobre os mesmos agregados.

## Privacidade, segurança e auditoria

- Prompts e respostas não são persistidos em histórico, logs ou analytics.
- O evento auditável registra somente ator, paciente autorizado, modo, data e identificador opaco da geração.
- O provedor completo não recebe identificadores de usuário, nome do paciente ou textos crus do acompanhamento.
- O classificador de foco recebe somente a pergunta redigida, sem catálogo ou dados do paciente.
- Conteúdo de contexto é tratado como dado não confiável, nunca como instrução.
- O aviso educacional informa que a saída não substitui diagnóstico, prescrição ou decisão clínica.
- O catálogo exibido na interface corresponde aos sinais enviados ao provedor completo, permitindo conferência do período atual e do anterior.
- A telemetria registra somente status, duração, modelo, contagem de fontes, uso numérico de tokens e motivo categorizado de fallback. Pergunta, prompt, resposta, valores clínicos, modo, identificador da geração e conteúdo do paciente não são registrados nas métricas.

Essas regras complementam `docs/PRIVACY_LGPD.md`, `docs/SECURITY.md` e `docs/RELIABILITY.md` sem alterar seus contratos de retenção, segredo ou observabilidade.

## Falhas e comportamento degradado

- Falha ou timeout da IA: retorna fallback determinístico.
- JSON, schema ou foco inválido: descarta a saída e retorna fallback determinístico.
- Vocabulário ou conteúdo clínico proibido: descarta a saída e retorna fallback determinístico.
- Referência de fonte inexistente ou indisponível: descarta a saída e retorna fallback determinístico.
- Pergunta livre classificada com foco válido: retorna resposta canônica específica e citada.
- Pergunta sensível não analítica, comando ou solicitação prescritiva: retorna limite clínico.
- Falha do relatório canônico: nenhuma geração é produzida.
- Revogação durante a geração: resposta descartada e telemetria registra apenas `authorization_invalidated`.
- Ausência de dados: aparece explicitamente em `missingData`; zero não é apresentado como aderência, média ou observação clínica.
- Mudança de paciente, período, modo, tipo de rascunho ou pergunta: resultado anterior é ocultado imediatamente e resposta atrasada é ignorada.
- Falha ao salvar rascunho: o texto permanece editável na tela e não aparece como enviado.
- Falha da telemetria: não impede a resposta segura nem substitui um erro de autorização.

## Testes obrigatórios

- minimização do contexto e ausência de textos crus no payload;
- catálogo completo para período atual e anterior;
- alertas atuais e anteriores consultados com intervalos diferentes e refletidos separadamente nas fontes;
- referência exata das fontes por resumo e interpretação;
- fatos e dados ausentes substituídos por valores canônicos do backend;
- rejeição de referência a sinal inexistente ou indisponível;
- resistência a instruções inseridas em conteúdo do paciente;
- fallback para erro, timeout, JSON inválido e schema inválido;
- classificação distinta entre geração completa, consulta determinística, classificador de foco e limite clínico;
- pergunta livre não prevista classificada por enum estrito e respondida com fonte canônica específica;
- foco clínico devolvido pelo classificador convertido em limite explícito;
- falha do classificador convertida em fallback determinístico;
- perguntas objetivas sensíveis sem chamada ao provedor;
- comandos diretos, formas impessoais, construções nominais, avaliações prescritivas e verbos desconhecidos;
- comandos com vegetais, cardápio, frutas, saladas e linguagem fora do domínio inicialmente enumerado;
- vocabulário factual controlado para todo texto livre do provedor completo;
- rejeição de conteúdo em alfabetos ou escritas não autorizadas;
- preservação de separadores numéricos em `1.800`, `2.000` e `93,3`;
- revogação entre a consulta e o retorno do provedor;
- declaração explícita de dados ausentes no período atual e anterior;
- rejeição de datas impossíveis e períodos acima de 90 dias;
- priorização derivada somente de alertas canônicos;
- bloqueio da priorização para perfil profissional inativo;
- desativação do endpoint legado de perguntas;
- redirecionamento da rota legada para a experiência atual;
- telemetria sem pergunta, prompt, resposta ou conteúdo do paciente;
- confirmação explícita antes de persistir um rascunho;
- descarte de resposta atrasada após troca de paciente, período ou modo.
