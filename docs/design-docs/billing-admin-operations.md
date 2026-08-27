# Operação administrativa de billing

## Escopo

`/admin/billing` é a superfície administrativa para os contratos comerciais, comunicações e governança já implementados pelos módulos de billing e `usageGovernance`. A rota não substitui serviços de domínio, não confirma fatos financeiros pelo navegador e não habilita rollout por conta própria.

Toda operação mutável é protegida no backend por `adminProcedure`. A autoria é obtida da sessão (`ctx.user.id`); o cliente não informa o administrador executor. Controles operacionais adicionais são persistidos como eventos append-only em `billingProviderEvents`, sem criar uma segunda fonte financeira.

## Catálogo e cupons

A tela permite listar versões, criar famílias, criar versões, publicar ou encerrar versões para novas contratações e administrar revisões de cupons. Preço, capacidade, matriz de entitlements, ciclo e meios de pagamento pertencem à versão contratada; contratos existentes não são reescritos.

Ações sensíveis exigem justificativa e confirmação. Cupons mantêm as invariantes do domínio: um cupom por contratação, não acumulação, percentual público máximo de 30%, mensal por uma a três cobranças, anual apenas na primeira cobrança e gratuidade integral somente por mecanismo administrativo apropriado.

## Economia e governança de uso

A visão econômica é **gerencial**, não escrituração contábil oficial. A interface apresenta, por competência e dimensões comerciais disponíveis:

- receita contratual reconhecida;
- descontos, cupons e créditos;
- reembolsos e chargebacks;
- impostos e taxas de recebimento;
- receita líquida econômica;
- custos variáveis diretamente atribuíveis;
- índice mensal e média móvel de três meses pela mesma fórmula versionada do backend;
- faixa de saúde, qualidade/cobertura e moeda;
- custo financeiro em coluna separada;
- custo indireto como não atribuído enquanto não houver fonte homologada.

Os marcos de orçamento 70%, 85% e 100% servem para alerta e revisão. O orçamento não é, isoladamente, uma autorização para alterar acesso ou criar cobrança. Moedas não comparáveis permanecem fora do índice até reconciliação.

A consulta detalhada por competência usa `usageGovernance.adminEconomicRows`: produto, versão e ciclo são aplicados no banco antes da materialização, sem `LIMIT` amostral de linhas recentes. Para preservar a média móvel, a leitura inclui somente os dois meses anteriores necessários e devolve ao painel apenas a competência solicitada. Pagador, beneficiário e patrocinador continuam identidades separadas; filtros de beneficiário/patrocinador são aplicados depois da correlação com a telemetria da mesma janela.

Retenção vigente:

- detalhe: 13 meses;
- agregados diários: 24 meses;
- agregados econômicos mensais e auditoria: 5 anos;
- conteúdo bruto de mensagens, prompts, respostas, imagens, áudios e transcrições não é disponibilizado para análise econômica.

Franquia temporária e isenção de limite não criam cobrança no Asaas.

## Possível abuso

Custo elevado isoladamente não comprova abuso. Casos normais exigem sinais combinados, evidência técnica sanitizada e revisão humana. A administração permite:

- abrir caso com operações pesadas relacionadas e, quando aplicável, evidência explícita de risco de segurança;
- consultar somente evidência sanitizada;
- atribuir responsável por evento administrativo auditável;
- registrar revisão confirmando que falhas/retries do próprio sistema e crescimento legítimo foram avaliados;
- descartar o caso ou aprovar o escopo de limitação;
- aplicar limitação inicial de até 7 dias;
- aplicar no máximo uma extensão de até 7 dias, cuja aprovação deve ser de outro administrador;
- usar proteção emergencial de até 24 horas somente quando a evidência de segurança e o escopo técnico permitirem;
- registrar comunicação e oferta de recurso junto com a limitação;
- consultar e decidir recursos pendentes;
- reverter limitação antes do vencimento com motivo auditável.

As invariantes de duração, segundo administrador, emergência e operações permitidas permanecem exclusivamente em `server/modules/usageGovernance/`; o frontend não as substitui. Login, consulta, exportação e registros manuais não entram no escopo das operações pesadas limitáveis.

O próprio usuário consulta suas limitações em **Plano e acesso** por `usageGovernance.myLimitations`. O read model devolve apenas escopo operacional, vigência, estado, comunicação e estado do recurso; evidências internas, sinais de investigação e responsáveis administrativos não são expostos. Quando `appealOfferedAt` existe e não há recurso pendente, a tela permite enviar manifestação por `usageGovernance.submitLimitationAppeal`. A decisão continua exclusiva da administração e uma aprovação usa a transação canônica que revoga a limitação ativa.

## Retenção e legal hold

`usageGovernance.adminOverview` expõe execuções de `billingUsageRetentionAudit`, legal holds ativos/históricos e correlações de reprocessamento. Um administrador pode reprocessar uma execução com justificativa; o pedido e seu resultado são registrados em evento append-only, enquanto a eliminação continua sendo executada pela política canônica de retenção.

A execução automática grava `status=success` somente dentro da mesma transação da purga. Se a transação falhar, o rollback preserva os dados e o repositório tenta gravar um registro separado `status=failed` com mensagem operacional estática e sanitizada, sem copiar SQL, payload ou conteúdo do erro. Quando até a persistência de auditoria estiver indisponível, o erro original continua sendo propagado para observabilidade externa.

`legal hold` documentado impede a eliminação apenas do escopo protegido enquanto estiver ativo. Revogação não apaga o histórico do hold.

## Campanhas e entregas

A fonte permanente da comunicação continua sendo o fato autoritativo de billing e sua projeção na central interna. `/admin/billing` acrescenta operação sobre esse histórico sem editar retrospectivamente o conteúdo enviado.

A administração exibe e filtra por campanha, versão, categoria, público, evento de disparo, marco, situação interna e canal. Para cada comunicação, mantém separados:

- central interna;
- e-mail;
- WhatsApp;
- tentativas e retries;
- falha de canal;
- reconhecimento e responsável;
- situação da ação do usuário;
- correlação com o fato original;
- estado de pausa da campanha.

Reprocessamento manual exige `requestId` idempotente e motivo. O evento administrativo é criado antes da tentativa externa e preserva campanha, versão, correlação e uma apresentação sanitizada do conteúdo. Repetir o mesmo `requestId` não dispara uma segunda tentativa.

Comunicações já concluídas, obsoletas ou pertencentes a campanha pausada exigem override administrativo justificado. Pausar uma campanha afeta novas tentativas e não apaga fatos, notificações ou entregas já registradas. Alteração futura de conteúdo deve gerar uma nova versão do fato/campanha; o conteúdo histórico permanece associado ao `factVersion` original.

Falha de e-mail ou WhatsApp nunca elimina a notificação interna. No estado atual, o transport de e-mail ainda não possui sender configurado no repositório; uma tentativa é registrada como falha em vez de simular entrega. WhatsApp usa o transport oficial e registra `pending` antes do efeito externo e `delivered` ou `failed` depois.

Categorias essenciais permanecem independentes de opt-out promocional. A classificação jurídica exibida é explicitamente pendente de homologação jurídica e de privacidade. Tokens, documentos, cartão, dados clínicos e payload bruto de provider não fazem parte do read model administrativo.

Analytics são agregados por campanha, versão e canal para dados realmente disponíveis: criadas, enviadas, entregues, falhas, retries, deduplicações observáveis, leitura da central interna e ação concluída. Abertura externa, tickets, opt-out e tempo de resolução permanecem `n/d` enquanto não houver fonte confiável, em vez de serem inferidos.

A listagem administrativa percorre o histórico autoritativo em páginas até o fim antes de aplicar o limite visual. Os filtros e os analytics operam sobre toda a população correspondente, e ações manuais localizam a notificação pelo histórico paginado do usuário; uma comunicação válida não desaparece apenas por estar além da amostra mais recente.

## Rollout

A #896 entrega também o **control plane administrativo** consumível pela #898 sem ativar cobrança: snapshots de coorte imutáveis e determinísticos por regra/chave, decisões manuais de gate com responsáveis nominais e métricas, incidentes, pausa/retomada com confirmação reforçada e registro de rollback para `open_access` por fase/snapshot. Esses fatos são append-only em `billingProviderEvents` e não alteram retroativamente cobranças, assinaturas, cancelamentos, estornos, capacidade ou eventos legítimos.

Não existe progressão automática por data. Avanço é bloqueado quando os mínimos operacionais não são atendidos, quando há incidente crítico/alto aberto ou quando existe qualquer incidente absoluto de cobrança duplicada, ativação indevida, bloqueio indevido, perda de dados ou exposição sensível. Progressão para qualquer fase `enforced` e retomada depois de incidente exigem confirmação reforçada.

O control plane **não muda `BILLING_ACCESS_MODE`**, não classifica/migra automaticamente usuários e não cria cobranças. A execução das coortes, migração e ativação progressiva continuam pertencendo à #898; até lá, `open_access` permanece o padrão seguro e obrigatório.

## Validação

Billing é área sensível. Antes do merge são necessários:

- `pnpm check`;
- `pnpm test`;
- `pnpm architecture:check`;
- `pnpm docs:check`;
- `pnpm build`;
- `pnpm agent:check`;
- `Agent-first gate` verde no SHA congelado;
- smoke de `/admin/billing` com administrador e bloqueio de não administrador;
- `pnpm billing-admin:visual`, renderizando a página administrativa real com fixture determinística de administrador em 1440x900, 1024x768 e 390x844, além de teclado, árvore de acessibilidade e zoom de 200%;
- artefato `billing-admin-visual-<SHA>` publicado pelo `Agent-first gate`, contendo os três screenshots, `browser-evidence.json` e `manifest.txt`;
- validação de banco quando a execução dispuser de `DATABASE_URL`.
