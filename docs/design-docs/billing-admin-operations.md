# Operação administrativa de billing

## Escopo

`/admin/billing` é a superfície administrativa para os contratos comerciais e de governança já implementados pelos módulos de billing e `usageGovernance`. A rota não substitui os serviços de domínio, não confirma fatos financeiros pelo navegador e não habilita rollout por conta própria.

Toda operação mutável é protegida no backend por `adminProcedure`. A autoria é obtida da sessão (`ctx.user.id`); o cliente não informa o administrador executor.

## Catálogo e cupons

A tela consome as procedures administrativas do catálogo versionado para:

- listar versões e seus estados;
- criar famílias de produto;
- criar novas versões sem editar contratos existentes;
- publicar uma versão para novas contratações;
- encerrar uma versão para novas contratações;
- listar, revisar e desativar cupons.

Preço, capacidade, matriz de entitlements, ciclo e meios de pagamento pertencem à versão. Alterações comerciais relevantes exigem nova versão e trilha de auditoria. Cupons continuam sujeitos às invariantes do domínio: um cupom por contratação, não acumulação, percentual público máximo de 30%, mensal por no máximo três cobranças, anual apenas na primeira cobrança e rejeição de 100% como cupom.

## Economia e governança de uso

A visão econômica usa exclusivamente `usageGovernance.analytics`. Ela é **gerencial**, não escrituração contábil oficial. A interface apresenta cobertura/qualidade dos dados junto aos indicadores e não mistura automaticamente moedas incompatíveis.

A política exibida vem do backend. No contrato atual:

- alertas de orçamento: 70%, 85% e 100%;
- atingir 100% não bloqueia automaticamente o uso normal;
- retenção detalhada: 13 meses;
- agregados diários: 24 meses;
- agregados econômicos mensais e auditoria: 5 anos;
- conteúdo bruto de mensagens, prompts, respostas, imagens, áudios e transcrições não é armazenado para análise econômica.

Franquia temporária e isenção de limite são operações locais de governança e não criam cobrança no Asaas.

## Possível abuso

Custo elevado isoladamente não comprova abuso. Um caso normal exige sinais combinados e evidência técnica sanitizada. Falhas e retries do próprio sistema precisam ser excluídos durante a revisão humana.

As regras autoritativas permanecem em `server/modules/usageGovernance/`:

- limitação inicial: até 7 dias;
- uma extensão: até 7 dias e aprovada por administrador diferente;
- proteção emergencial: até 24 horas, somente com risco de segurança comprovado;
- somente operações pesadas relacionadas podem ser limitadas;
- login, consulta, exportação e registros manuais permanecem disponíveis;
- comunicação e possibilidade de recurso são requisitos do fluxo normal;
- limitações podem ser revogadas antecipadamente com auditoria.

A interface administrativa abre o caso e deixa a decisão/limitação sujeita às invariantes do backend; não replica essas regras no frontend.

## Retenção e legal hold

`legal hold` documentado impede a eliminação do escopo protegido enquanto estiver ativo. O job de retenção e suas regras são governados por `usageGovernance`; conteúdo conversacional bruto não é disponibilizado pela administração econômica.

## Comunicações e rollout

Notificações financeiras e de capacidade permanecem derivadas de fatos autoritativos de billing. Falha em e-mail ou WhatsApp não invalida a notificação interna. Histórico já criado não deve ser reescrito retrospectivamente.

A #896 expõe controles e indicadores administrativos; a execução de coortes, fases, kill switch, migração e ativação de `BILLING_ACCESS_MODE=enforced` pertence à #898. Nenhum controle desta tela, isoladamente, autoriza rollout ou cobrança variável em produção.

## Validação

Billing é área sensível. Mudanças nesta superfície exigem, antes do merge:

- `pnpm agent:check`;
- `pnpm build`;
- `Agent-first gate` verde na PR;
- smoke da rota `/admin/billing` com administrador e verificação de bloqueio para não administrador;
- validação de banco aplicável quando houver alteração de persistência.
