# Plano técnico - melhorias de dashboard, configurações, registros e Strava

## Contexto

Este plano organiza o pacote de melhorias solicitado para o repositório `crgasparoto-br/controle_calorias`, considerando o estado atual do `main` e evitando retrabalho em funcionalidades que já existem parcialmente.

## Priorização por área

### P0 - Experiência principal e navegação

- Consolidar Dashboard e Relatórios em uma única experiência de painel, removendo o item redundante de menu.
- Renomear `Onboarding` para `Configurações` no menu e criar alias `/settings` mantendo `/onboarding` compatível.
- Padronizar textos do fluxo de refeição para `Registro de refeição` e ação primária `Registrar`.
- Manter ícones nos botões e reforçar consistência visual.

### P1 - Registros do dia

- Evoluir a tela de registros para agrupar refeições, água, exercícios e outros eventos em uma linha do tempo diária única.
- Preservar filtros por data, navegação por dia e visão em lista para reduzir ruído visual.
- Usar o utilitário central de data/hora e formatação pt-BR já existente no projeto.

### P1 - Configurações

- Mover blocos administrativos/de relacionamento para Configurações:
  - vínculo do contrato do usuário;
  - solicitações recebidas como paciente, com título `Solicitações recebidas`.
- Incluir CRUD de refeições habituais com janela de horário por usuário.
- Usar as janelas habituais para sugerir automaticamente a refeição no registro conforme horário local do usuário.

### P1 - Registro de refeição com IA

- Unificar os caminhos `registrar refeição por foto` e `registrar refeição com IA multimodal` em um único módulo.
- Retirar o fluxo de confirmação separado para reduzir sujeira e duplicidade de itens.
- Persistir diretamente a inferência limpa, permitindo edição posterior pelo CRUD/manual.
- Revisar prompts e normalização para limitar alimentos extras no retorno multimodal.

### P2 - Nutricionista

- Alterar o bloco `Solicitar acesso` para aceitar e-mail do paciente em vez de ID.
- Resolver e validar o paciente no backend por e-mail antes de criar solicitação.
- Manter mensagens de erro claras para e-mail inexistente, duplicidade e acesso já concedido.

### P2 - Saúde externa / Strava

- Adicionar Strava como provedor web OAuth.
- Expor estado de configuração pendente quando `STRAVA_CLIENT_ID` e `STRAVA_REDIRECT_URI` não estiverem definidos.
- Preparar URL de autorização OAuth com escopos mínimos `read,activity:read`.
- Próximas etapas: callback OAuth, troca de `code` por tokens, persistência segura dos tokens e sincronização de atividades para minutos/gasto energético.

## Riscos e dependências

- **Dashboard lento:** precisa de medição de queries e payload. Risco de otimização prematura sem tracing. Próximo passo recomendado: medir endpoints mais lentos e reduzir chamadas duplicadas entre Dashboard/Relatórios.
- **Configurações com novos CRUDs:** exige modelo persistente para refeições habituais e possivelmente migração Drizzle.
- **Sugestão automática de refeição:** depende de fuso horário correto e da definição de regra para intervalos sobrepostos.
- **IA multimodal sem confirmação:** melhora fluidez, mas aumenta impacto de inferências incorretas; precisa manter edição posterior fácil.
- **Paciente por e-mail:** exige índice/consulta confiável por e-mail e política para e-mails duplicados ou nulos.
- **Strava:** exige credenciais, callback público HTTPS, armazenamento seguro de tokens e refresh token.

## Dúvidas funcionais

1. A tela única de registros deve substituir `/meals` ou virar um novo caminho `/records`?
2. As refeições habituais devem ser globais do usuário ou podem variar por dia da semana?
3. Em intervalos sobrepostos, a sugestão deve escolher a refeição com horário central mais próximo ou a de maior prioridade configurada?
4. O contrato do usuário já tem entidade persistida ou hoje é apenas bloco visual?
5. No Strava, a primeira entrega deve importar apenas atividades recentes ou também manter webhooks para novas atividades?

## Implementação feita nesta branch

- Menu renomeado: `Onboarding` virou `Configurações`.
- Criado alias `/settings` apontando para a tela atual de configurações/onboarding sem quebrar `/onboarding`.
- Removido item `Relatórios` do menu para reduzir redundância com o Dashboard.
- Ajustados rótulos de navegação de refeição para `Registro de refeição` e `Registros`.
- Adicionado Strava ao schema de provedores de saúde.
- Preparada base de autorização OAuth do Strava no backend quando variáveis de ambiente estiverem presentes.
- Tela Saúde externa passa a mostrar estado de configuração do Strava e botão `Conectar Strava` quando houver URL de autorização.

## Validação planejada

- `pnpm check`
- `pnpm test`
- `pnpm architecture:check`

Não foi possível executar validações localmente neste ambiente porque o clone via rede não conseguiu resolver `github.com`. A validação final deve ser feita no CI ou em ambiente local com acesso ao repositório.
