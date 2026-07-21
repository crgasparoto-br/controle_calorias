# Aposentadoria da compatibilidade profissional legada

## Objetivo

Encerrar a leitura e a escrita em JSON de perfil e autorizações profissionais sem perder histórico, identificadores ou vínculos já migrados para as tabelas canônicas.

## Pré-condições

- todas as migrations da Área Profissional aplicadas;
- backup recente do banco;
- versão anterior disponível para rollback;
- CI da issue #815 aprovado;
- nenhuma preferência inválida reportada pelo backfill.

## Rollout

1. Execute `pnpm db:migrate:professionals` no ambiente alvo.
2. Execute `pnpm db:retire-professional-legacy`. O comando migra novamente de forma idempotente e verifica cobertura canônica; ele não exclui dados.
3. Interrompa o rollout se houver preferência inválida, perfil ausente ou autorização ausente. Corrija a origem e repita a verificação.
4. Execute `pnpm db:retire-professional-legacy:apply` para remover somente as três chaves antigas de `userPreferences`.
5. Publique a versão da issue #815, que não possui migração lazy nem dual-write em runtime.
6. Valide perfil profissional, solicitação/aprovação/revogação, carteira, prontuário, metas, alertas, mensagens, relatórios, IA e configurações.
7. Monitore erros de autorização, falhas de persistência e tentativas de acesso a `/professional/legacy`.

## Rollback

1. Reverta a aplicação para a versão anterior sem restaurar parcialmente tabelas.
2. As tabelas canônicas permanecem como fonte de verdade e preservam os mesmos identificadores.
3. Restaure o backup apenas se a verificação canônica ou a validação funcional apontar perda de dados.
4. Não recrie manualmente JSONs em `userPreferences`; execute o backfill idempotente da versão anterior somente quando uma análise de incidente exigir.

## Evidências obrigatórias

Registre a saída JSON dos dois comandos, o SHA publicado, o resultado das validações funcionais e a decisão de prosseguir ou reverter. Nunca execute o modo `--apply` quando a verificação apontar dados inválidos ou cobertura incompleta.
