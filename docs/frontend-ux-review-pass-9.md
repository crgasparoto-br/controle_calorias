# Frontend UX Review Pass 9

## Escopo

Passada curta de consistência visual focada nas telas `Login` e `Cadastro`.

## Diagnóstico atacado

- as duas telas tinham estrutura funcional, mas ainda muito simples e desconectada do padrão visual mais recente do app;
- login e cadastro repetiam o mesmo tipo de layout sem reutilização, o que dificultava manter consistência;
- faltava uma entrada mais forte para a primeira impressão do produto em mobile e desktop.

## Melhorias aplicadas

- criação de `AuthShell` reutilizável para a camada de autenticação;
- reorganização visual das telas de login e cadastro com melhor hierarquia e leitura;
- manutenção integral da lógica de autenticação, mutações e redirecionamento;
- simplificação posterior da tela de login, removendo o painel lateral informativo e expondo a opção `Esqueceu a senha?` com orientação honesta sobre a indisponibilidade atual da recuperação automática.

## Telas alteradas

- `client/src/pages/LoginPage.tsx`
- `client/src/pages/RegisterPage.tsx`
- `client/src/components/AuthShell.tsx`

## Validação

Validação automática local não executada neste ambiente porque o repositório não está clonado no workspace atual.
A checagem final deve seguir o preview e os comandos padrão do repositório.
