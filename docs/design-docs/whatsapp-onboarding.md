# Design técnico: onboarding e saudação via WhatsApp

## Responsabilidade

Permitir que um telefone ainda não vinculado inicie o cadastro pelo WhatsApp sem criar uma conta completa automaticamente. O primeiro contato gera um lead com token opaco, expirável, e um link para finalização do cadastro no site.

O cadastro, a elegibilidade comercial e o envio da saudação são responsabilidades separadas. Concluir os dados não cria assinatura nem confirma pagamento. A elegibilidade é obtida do serviço central da épica #145.

## Fluxo implementado: WhatsApp para site

1. O webhook recebe mensagem de um telefone de origem.
2. O wrapper inicial consulta se existe usuário vinculado ao telefone.
3. Quando não existe usuário, o sistema cria ou reaproveita um lead em `whatsapp_onboarding_leads`.
4. O lead recebe status `pending_onboarding` e token randômico armazenado apenas como hash.
5. O WhatsApp responde com botão para `/onboarding/whatsapp/:token`.
6. A página pública valida o token antes de exibir o formulário.
7. O site coleta dados de acesso, perfil nutricional e consentimentos obrigatórios.
8. Ao concluir, o backend cria a conta local, salva o onboarding, vincula o WhatsApp e registra consentimentos em `userPreferences`.
9. O token é marcado como usado e o lead convertido fica associado ao usuário.
10. O backend consulta `getUserEntitlements(userId)`.
11. A procedure retorna `eligibility` e `nextAction`:
    - `continue`, quando existe uma origem válida de acesso;
    - `await_activation`, quando o cadastro foi concluído, mas o uso protegido ainda não está liberado.
12. A página redireciona o usuário liberado para o onboarding normal ou o usuário pendente para `/billing`.

O lead convertido continua usando o estado histórico `active` da tabela atual. A pendência comercial não é inferida desse campo: ela é representada pelo resultado central de elegibilidade. Uma futura migration para `pending_activation` deve ser coordenada com a implementação completa da #215 e não pode substituir a fonte de verdade de billing.

## Bloqueio pré-pipeline no WhatsApp

Depois de localizar um usuário pelo telefone e antes de executar qualquer fluxo nutricional, `whatsappImageIdempotencyWebhook.ts` consulta o serviço central de elegibilidade.

Quando `allowed = false`:

- a mensagem não chega ao pipeline de texto, imagem ou áudio;
- nenhuma refeição, água, exercício ou confirmação é persistida;
- o usuário recebe orientação para consultar **Plano e acesso** no sistema web;
- o evento é registrado sem telefone, conteúdo cru ou detalhes financeiros sensíveis.

No modo `open_access`, o comportamento atual é preservado. No modo `enforced`, o bloqueio ocorre para qualquer mensagem protegida.

## Fluxo implementado: site para saudação WhatsApp

1. A página de onboarding web consulta o status do WhatsApp do usuário logado.
2. Quando existe telefone vinculado, a tela mostra uma opção para enviar saudação única pelo WhatsApp.
3. Quando não existe telefone vinculado, a aba Perfil das configurações permite informar o telefone do usuário final com país/código separado, trazendo Brasil (+55) como padrão e permitindo escolher os demais países da lista.
4. O envio exige aceite explícito de contato operacional pelo WhatsApp e não habilita marketing.
5. Ao salvar o perfil com um telefone novo, a tela valida o número local, junta o código do país selecionado ao número informado, salva primeiro o vínculo em `nutrition.whatsapp.upsertConnection` e em seguida chama `auth.sendWhatsappGreeting`.
6. Ao salvar o onboarding com telefone já vinculado, a tela chama `auth.sendWhatsappGreeting` apenas se a opção de saudação estiver marcada.
7. O backend verifica consentimento, telefone vinculado e auditoria anterior para evitar duplicidade.
8. Quando permitido, o sistema envia a mensagem de saudação e registra status, canal e template em `userPreferences`.

No onboarding iniciado pelo WhatsApp, a saudação só é disparada quando a elegibilidade central está liberada. Falha de envio não altera a decisão comercial nem apaga cadastro, consentimentos ou vínculo.

Mensagem enviada:

> Olá, {nome}! Obrigado por se cadastrar no Controle de Calorias. Salve este número para registrar suas refeições, água e exercícios pelo WhatsApp sempre que precisar.

## Fora de escopo desta etapa

- Escolher provedor financeiro, publicar preço ou criar checkout real.
- Criar assinatura `pending` sem catálogo e política comercial aprovados.
- Confirmar pagamento pelo retorno do navegador.
- Implementar trial sem decisão comercial.
- Criação de conta completa apenas com a primeira mensagem no WhatsApp.
- Disparos ativos de marketing.
- Mensagens recorrentes sem nova regra de consentimento.
- Migração automática de usuários existentes.
- Alteração livre de telefone quando já existe vínculo WhatsApp ativo para o usuário.

## Segurança e privacidade

- O token não contém telefone nem dados pessoais em claro.
- O token é armazenado como SHA-256 e expira em 24 horas.
- O telefone exibido na página pública é mascarado.
- O telefone informado na aba Perfil é tratado como dado pessoal sensível para logs e mensagens de erro.
- O fluxo exige aceite de termos, política de privacidade, tratamento de dados necessários ao serviço e comunicação operacional pelo WhatsApp.
- Marketing pelo WhatsApp é opt-in separado e opcional.
- A saudação web exige consentimento operacional específico antes do envio.
- Logs do serviço usam telefone mascarado nos eventos novos do onboarding.
- A resposta de acesso pendente não informa plano, dívida, valor ou motivo financeiro detalhado.

## Persistência

Tabela: `whatsapp_onboarding_leads`.

Campos principais:

- `phone_number`: telefone normalizado.
- `display_name`: nome vindo do canal quando disponível.
- `origin`: origem do lead, inicialmente `whatsapp`.
- `status`: `lead_whatsapp`, `pending_onboarding`, `active`, `expired` ou `canceled`.
- `token_hash`: hash do token opaco.
- `token_expires_at`: expiração do link.
- `token_used_at`: uso único do link.
- `converted_user_id` e `converted_at`: vínculo com o usuário convertido.
- `last_message_at`: idempotência operacional para mensagens repetidas do mesmo telefone.

A compatibilidade de runtime também cria a tabela quando ela ainda não existe no banco configurado.

A saudação do onboarding web usa `userPreferences` com a chave `whatsapp_web_greeting_status` para registrar:

- status do envio;
- canal `whatsapp`;
- identificador lógico de template `web_onboarding_greeting_v1`;
- momento da tentativa/envio;
- motivo de skip ou falha quando aplicável.

O telefone informado pela aba Perfil usa o mesmo contrato e persistência de `whatsappConnections` já exposto por `nutrition.whatsapp.upsertConnection`; não há migration nova para esse ajuste.

## Contratos públicos

Rotas tRPC públicas em `auth.whatsappOnboarding`:

- `validate({ token })`: valida o token e retorna telefone mascarado, status e expiração.
- `complete({ token, email, password, profile, consents })`: cria a conta, salva onboarding, vincula WhatsApp, inicia sessão e retorna `{ user, eligibility, nextAction }`.

Rotas tRPC protegidas:

- `billing.subscriptionStatus`: consulta a origem efetiva, assinatura própria e capacidade profissional sem depender da liberação dos demais recursos.
- `auth.sendWhatsappGreeting({ acceptedOperationalWhatsapp })`: envia ou registra skip da saudação inicial para usuário logado com WhatsApp vinculado.
- `nutrition.whatsapp.upsertConnection({ phoneNumber, displayName })`: vincula o telefone do usuário final à conta logada e impede uso do número oficial da solução como telefone pessoal.

## Validação

- Telefone novo no webhook cria/reaproveita lead e não processa refeição.
- Token válido abre a página pública e mostra telefone mascarado.
- Token inválido, expirado ou usado mostra estado de erro amigável.
- Cadastro sem consentimentos obrigatórios é recusado.
- `open_access` conclui o cadastro, retorna `continue` e envia a saudação uma única vez.
- Elegibilidade negada conclui o cadastro, retorna `await_activation` e não envia saudação.
- Usuário pendente que envia imagem com quantidade explícita de água não produz registro nutricional.
- Usuário elegível continua no fluxo normal de refeição, hidratação e comandos.
- Onboarding web exibe a opção de saudação apenas quando houver telefone WhatsApp vinculado.
- Salvar Perfil com telefone novo persiste o vínculo com o código do país selecionado e tenta enviar a saudação inicial uma única vez.
- Saudação web não é enviada sem consentimento operacional.
- Saudação web registra status e evita duplicidade depois de envio concluído.
