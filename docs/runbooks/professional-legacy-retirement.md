# Aposentadoria da compatibilidade profissional legada

## Objetivo

Encerrar a leitura e a escrita em JSON de perfil, autorizações e sugestões profissionais sem perder histórico, identificadores, vínculos ou conteúdo já migrado para as tabelas canônicas.

## Pré-condições

- todas as migrations da Área Profissional aplicadas;
- backup recente do banco;
- versão anterior disponível para rollback;
- CI da issue #815 aprovado;
- nenhuma preferência inválida reportada pelo backfill.

## Rollout

1. Execute `pnpm db:migrate:professionals` no ambiente alvo.
2. Execute `pnpm db:retire-professional-legacy`. Antes de qualquer nova migração ou escrita, o comando faz um preflight somente leitura das quatro chaves antigas e interrompe sem modificar dados quando encontra JSON inválido ou cópias da mesma versão com conteúdo divergente. Depois do preflight, migra novamente de forma idempotente, compara identidade, campos imutáveis, conteúdo, marcos temporais e progressão de estado e não exclui dados. Para sugestões profissionais, a versão canônica corresponde ao maior marco entre criação, envio e resposta, preservando corretamente o ciclo de vida legado.
3. Interrompa o rollout se houver preferência inválida, cobertura canônica ausente, registro desatualizado ou cópias legadas da mesma versão com conteúdo divergente. Corrija a origem e repita a verificação.
4. Publique a versão da issue #815, que não possui migração lazy nem dual-write em runtime. Não execute ainda o modo `--apply`.
5. Execute `pnpm professional-retirement:check` e a matriz de `docs/testing/professional-legacy-retirement-regression.md`; valide perfil profissional, solicitação/aprovação/revogação, carteira, prontuário, metas, alertas, mensagens, relatórios, IA, configurações e a Área do Paciente.
6. Execute `pnpm db:retire-professional-legacy:apply` somente após a versão canônica estar saudável em produção. Isso evita que instâncias antigas recriem os JSONs durante o rollout.
7. Execute novamente `pnpm db:retire-professional-legacy:apply` após encerrar todas as instâncias da versão anterior e confirme `legacyRowsRemaining: 0`.
8. Monitore erros de autorização, falhas de persistência e tentativas de acesso a `/professional/legacy`.

## Rollback

1. Reverta a aplicação para a versão anterior sem restaurar parcialmente tabelas.
2. As tabelas canônicas permanecem como fonte de verdade e preservam os mesmos identificadores.
3. Restaure o backup apenas se a verificação canônica ou a validação funcional apontar perda de dados.
4. Não recrie manualmente JSONs em `userPreferences`; execute o backfill idempotente da versão anterior somente quando uma análise de incidente exigir.

## Evidências obrigatórias

Registre a saída JSON dos dois comandos, o SHA publicado, o resultado das validações funcionais e a decisão de prosseguir ou reverter. Nunca execute o modo `--apply` quando a verificação apontar dados inválidos, cobertura incompleta ou conflito de mesma versão.
