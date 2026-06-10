# Design técnico: onboarding e saudação via WhatsApp

## Responsabilidade

Permitir que um telefone ainda não vinculado inicie o cadastro pelo WhatsApp sem criar uma conta completa automaticamente. O primeiro contato gera um lead com token opaco, expirável, e um link para finalização do cadastro no site.

Esta implementação cobre a parte do onboarding da issue #209 sem a etapa de pagamento e inclui a saudação inicial da issue #292 para usuários que completam o onboarding pela web.

## Fluxo implementado: WhatsApp para site

1. O webhook recebe mensagem de um telefone de origem.
2. O wrapper inicial consulta se existe usuário ativo vinculado ao telefone.
3. Quando não existe usuário ativo, o sistema cria ou reaproveita um lead em `whatsapp_onboarding_leads`.
4. O lead recebe status `pending_onboarding` e token randômico armazenado apenas como hash.
5. O WhatsApp responde com botão para `/onboarding/whatsapp/:token`.
6. A página pública valida o token antes de exibir o formulário.
7. O site coleta dados de acesso, perfil nutricional e consentimentos obrigatórios.
8. Ao concluir, o backend cria a conta local, salva o onboarding, vincula o WhatsApp como ativo e registra consentimentos em `userPreferences`.
9. O token é marcado como usado e o lead passa para `active`.

## Fluxo implementado: site para saudação WhatsApp

1. A página de onboarding web consulta o status do WhatsApp do usuário logado.
2. Quando existe telefone vinculado, a tela mostra uma opção para enviar saudação única pelo WhatsApp.
3. O envio exige aceite explícito de contato operacional pelo WhatsApp e não habilita marketing.
4. Ao salvar o onboarding, a tela chama `auth.sendWhatsappGreeting` se a opção estiver marcada.
5. O backend verifica consentimento, telefone vinculado e auditoria anterior para evitar duplicidade.
6. Quando permitido, o sistema envia a mensagem de saudação e registra status, canal e template em `userPreferences`.

Mensagem enviada:

> Olá, {nome}! Obrigado por se cadastrar no Controle de Calorias. Salve este número para registrar suas refeições, água e exercícios pelo WhatsApp sempre que precisar.

## Fora de escopo

- Cobrança, escolha de plano ou redirecionamento para pagamento.
- Criação de conta completa apenas com a primeira mensagem no WhatsApp.
- Disparos ativos de marketing.
- Mensagens recorrentes sem nova regra de consentimento.
- Migração automática de usuários existentes.

## Segurança e privacidade

- O token não contém telefone nem dados pessoais em claro.
- O token é armazenado como SHA-256 e expira em 24 horas.
- O telefone exibido na página pública é mascarado.
- O fluxo exige aceite de termos, política de privacidade, tratamento de dados necessários ao serviço e comunicação operacional pelo WhatsApp.
- Marketing pelo WhatsApp é opt-in separado e opcional.
- A saudação web exige consentimento operacional específico antes do envio.
- Logs do serviço usam telefone mascarado nos eventos novos do onboarding.

## Persistência

Tabela nova: `whatsapp_onboarding_leads`.

Campos principais:

- `phone_number`: telefone normalizado.
- `display_name`: nome vindo do canal quando disponível.
- `origin`: origem do lead, inicialmente `whatsapp`.
- `status`: `lead_whatsapp`, `pending_onboarding`, `active`, `expired` ou `canceled`.
- `token_hash`: hash do token opaco.
- `token_expires_at`: expiração do link.
- `token_used_at`: uso único do link.
- `converted_user_id` e `converted_at`: vínculo com o usuário ativado.
- `last_message_at`: idempotência operacional para mensagens repetidas do mesmo telefone.

A compatibilidade de runtime também cria a tabela quando ela ainda não existe no banco configurado.

A saudação do onboarding web usa `userPreferences` com a chave `whatsapp_web_greeting_status` para registrar:

- status do envio;
- canal `whatsapp`;
- identificador lógico de template `web_onboarding_greeting_v1`;
- momento da tentativa/envio;
- motivo de skip ou falha quando aplicável.

## Contratos públicos

Rotas tRPC públicas em `auth.whatsappOnboarding`:

- `validate({ token })`: valida o token e retorna telefone mascarado, status e expiração.
- `complete({ token, email, password, profile, consents })`: cria a conta, salva onboarding, vincula WhatsApp e inicia sessão.

Rota tRPC protegida em `auth`:

- `sendWhatsappGreeting({ acceptedOperationalWhatsapp })`: envia ou registra skip da saudação inicial para usuário logado com WhatsApp vinculado.

## Validação recomendada

- Telefone novo no webhook cria/reaproveita lead e não processa refeição.
- Telefone ativo continua no fluxo normal de refeição, hidratação e comandos.
- Token válido abre a página pública e mostra telefone mascarado.
- Token inválido, expirado ou usado mostra estado de erro amigável.
- Cadastro sem consentimentos obrigatórios é recusado.
- Cadastro completo ativa usuário sem pagamento e vincula WhatsApp.
- Onboarding web exibe a opção de saudação apenas quando houver telefone WhatsApp vinculado.
- Saudação web não é enviada sem consentimento operacional.
- Saudação web registra status e evita duplicidade depois de envio concluído.
