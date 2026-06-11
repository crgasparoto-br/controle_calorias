# Especificação de produto: registro de refeições

## Objetivo

Permitir que o usuário registre refeições por texto, imagem, áudio ou entrada manual, revise a inferência nutricional e confirme apenas dados que deseja persistir.

## Fluxo principal

1. Usuário informa uma refeição pelo canal web ou WhatsApp.
2. Sistema cria um rascunho com itens, porções, calorias, proteínas, carboidratos e gorduras.
3. Usuário revisa e ajusta os itens inferidos.
4. Sistema confirma a refeição, persiste itens individuais e atualiza totais, hábitos e relatórios.

## Regras de produto

- Toda inferência nutricional deve ser tratada como rascunho até confirmação explícita ou fluxo conversacional equivalente.
- O usuário deve conseguir entender quais alimentos foram identificados e quais valores foram estimados.
- Alimentos reconhecidos por imagem com categoria confiável, como pães de padaria sem tabela nutricional visível, devem usar valores estimados em vez de manter calorias e macronutrientes zerados.
- Refeições confirmadas devem aparecer nos relatórios, dashboard e totais diários.
- Texto original, transcrição e mídia são dados sensíveis; usar apenas pelo tempo necessário e evitar logs crus.

## Critérios de aceite

- Texto, imagem e áudio criam rascunho consistente.
- Confirmação persiste refeição e itens com macros por item.
- Erros de rascunho inexistente retornam mensagem amigável.
- Alterações no fluxo rodam `pnpm agent:check`.
