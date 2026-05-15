# Especificação de produto: privacidade, exportação e exclusão

## Objetivo

Garantir que usuários consigam exportar seus dados e solicitar exclusão de conta, mantendo tratamento cuidadoso de dados sensíveis de saúde, alimentação, mídia, telefone e inferência por IA.

## Dados sensíveis relevantes

- Perfil de saúde, peso, objetivo nutricional e restrições.
- Refeições, itens, macros, textos originais, transcrições e mídia.
- Telefone de origem do WhatsApp.
- Logs de inferência, razões de IA, prompts, tokens e URLs de mídia.

## Regras de produto

- Exportação deve retornar dados do próprio usuário autenticado.
- Solicitação de exclusão deve ser rastreável e segura.
- Logs e analytics devem usar resumos, contadores e categorias, nunca conteúdo cru.
- Novas integrações externas devem documentar finalidade, base de uso, retenção e exclusão.

## Critérios de aceite

- `privacy.exportData` não retorna dados de outro usuário.
- `privacy.requestAccountDeletion` registra solicitação ou executa fluxo aprovado.
- Alterações em IA, WhatsApp, mídia ou logs atualizam `docs/PRIVACY_LGPD.md`.
