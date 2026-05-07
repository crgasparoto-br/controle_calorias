# Revisao tecnica LGPD e dados de saude

Data: 2026-05-07

## Escopo

Revisao do sistema `controle_calorias` com foco em dados pessoais, dados sensiveis de saude, consentimento, exclusao, exportacao, logs, analytics, acesso profissional e envio para IA.

## Mapa de dados sensiveis

| Categoria | Exemplos | Onde aparece |
| --- | --- | --- |
| Identificacao | nome, email, openId, metodo de login | `users`, `userProfiles` |
| Perfil de saude/alimentacao | idade, altura, peso, objetivo nutricional, nivel de atividade, rotina alimentar, dificuldades | `userProfiles`, `weightEntries`, `userPreferences` |
| Alimentacao | refeicoes, itens, porcoes, calorias, macros, notas, transcricoes, fotos/audios | `meals`, `mealItems`, `mealMedia`, `mealInferences`, `mealFavorites`, `habitMemories` |
| Restricoes | alergias, intolerancias, dietas, condicoes medicas informadas em texto | `userRestrictions`, contexto do assistente alimentar |
| Hidratação e exercicio | agua, exercicios, calorias gastas, notas | `waterGoals`, `waterLogs`, `exercises` |
| Canais externos | telefone WhatsApp, nome exibido, token administrativo criptografado | `whatsappConnections`, `appSecrets` |
| Compartilhamento profissional | solicitacoes, consentimento aprovado/revogado, comentarios e sugestoes | modulo `professionals` em memoria neste estado do codigo |
| IA | pedido do usuario, contexto nutricional resumido, midias por URL quando ha foto/audio | `server/_core/llm.ts`, `server/modules/assistant`, `server/modules/meals`, `server/whatsappWebhook.ts` |

## Melhorias implementadas

- Novo utilitario `server/privacy.ts` para mascarar emails, telefones, tokens e chaves sensiveis antes de logs/auditoria.
- Falhas de LLM nao persistem mais corpo bruto da resposta de erro do provedor; apenas status e resumo estrutural do payload.
- Mensagem enviada ao assistente alimentar passa por redacao de identificadores comuns antes do envio para IA.
- Logs persistidos em `inferenceLogs` passam por sanitizacao.
- Coletor de debug do Vite sanitiza entradas antes de gravar arquivos locais em `.manus-logs`.
- Novo endpoint autenticado `nutrition.privacy.exportData` para exportar dados principais em JSON.
- Novo endpoint autenticado `nutrition.privacy.requestAccountDeletion` para solicitar/remover conta e dados principais vinculados.
- Compartilhamento com profissional ja depende de fluxo de solicitacao pendente e aprovacao explicita do paciente; revogacao existe.

## Politica de exclusao

O endpoint `nutrition.privacy.requestAccountDeletion` remove ou desvincula:

- Conta (`users`) e perfil (`userProfiles`).
- Refeicoes, itens, midias, favoritos, inferencias e memorias de habito.
- Metas, resumo diario, peso, agua, exercicios, preferencias, restricoes, gamificacao e vinculos WhatsApp.
- Logs de inferencia vinculados ao usuario.
- Alimentos criados pelo usuario sao desvinculados (`createdByUserId = null`) para evitar chave estrangeira e reduzir identificacao.
- Segredos administrativos atualizados pelo usuario sao preservados, mas desvinculados de `updatedByUserId`.

Backups, logs de infraestrutura fora do banco e arquivos externos em storage ainda precisam de politica operacional de retencao.

## Exportacao

O endpoint `nutrition.privacy.exportData` retorna:

- Conta e perfil.
- Metas nutricionais.
- Refeicoes e favoritos principais.
- Exercicios, hidratacao e peso.
- Preferencias e restricoes.
- Estado do WhatsApp.
- Avisos sobre consentimento profissional e integracoes de saude.

Formato atual: JSON via tRPC autenticado.

## Logs e analytics

Analytics usa catalogo central com propriedades agregadas em `shared/analytics.ts` e documentacao em `docs/analytics-events.md`. Nao deve enviar nomes de alimentos, termos de busca, notas livres, email, telefone, peso, altura, idade, barcode ou informacoes medicas.

Risco mitigado: detalhes de erro e coletor de debug agora passam por redacao basica.

Risco restante: qualquer `console.*` novo pode vazar dado se registrar objetos crus. Recomenda-se lint/regra de revisao para impedir logs de payloads de saude.

## Criptografia

- Em transito: depende de HTTPS/TLS no ambiente de deploy e dos provedores externos. O codigo nao deve operar em producao sem TLS no proxy/gateway.
- Em repouso: token administrativo WhatsApp em `appSecrets.valueEncrypted` usa AES-256-GCM derivado de `ENV.cookieSecret`.
- Dados de saude em tabelas principais nao tem criptografia de campo no codigo atual. Dependem de criptografia do banco/disco gerenciado.

## IA e servicos externos

O assistente alimentar envia contexto nutricional sem nome/email/id, mas ainda pode conter preferencias e restricoes alimentares. A mensagem do usuario e redigida para emails, telefones e tokens antes do envio.

Foto/audio/transcricao podem envolver servicos externos de transcricao/LLM e URLs de storage. Recomenda-se consentimento explicito por canal antes de usar midia com IA, retencao curta de `mealInferences` e URLs assinadas com expiracao.

## Riscos restantes

- Falta persistencia em banco do modulo `professionals`; consentimentos e comentarios ficam em memoria e nao entram integralmente na exportacao/exclusao quando houver restart.
- Nao ha comprovante formal de consentimento LGPD por finalidade para IA, WhatsApp e integracoes de saude.
- Midias em storage externo nao sao apagadas por chave nesta alteracao; o registro de banco e removido.
- Politica de backup, retencao e criptografia gerenciada do banco precisa ser configurada fora do codigo.
- Debug collector continua ativo em desenvolvimento; ja sanitiza, mas o ideal e desabilitar em ambientes com dados reais.
- `mealInferences.sourceText` e `transcript` armazenam texto alimentar bruto; avaliar retencao curta ou minimizacao.

## Criterios de aceite

- Dados sensiveis nao aparecem em logs novos conhecidos: atendido por redacao em `server/privacy.ts`, LLM, logs persistidos e debug collector.
- Usuario consegue solicitar exclusao de conta/dados: atendido por `nutrition.privacy.requestAccountDeletion`.
- Usuario consegue exportar dados principais: atendido por `nutrition.privacy.exportData`.
- Compartilhamento depende de consentimento: atendido no fluxo atual de acesso profissional pendente/aprovado/revogado.
- Relatorio tecnico gerado: este documento.
