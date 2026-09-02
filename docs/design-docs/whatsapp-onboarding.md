# Design técnico: onboarding e saudação via WhatsApp

## Responsabilidade

Permitir que um telefone ainda não vinculado inicie o cadastro pelo WhatsApp sem criar uma conta completa automaticamente. O primeiro contato gera um lead com token opaco, expirável, e um link para finalização do cadastro no site.

O cadastro, a elegibilidade comercial, a contratação e o envio da saudação são responsabilidades separadas. Concluir os dados não cria assinatura nem confirma pagamento. Catálogo, trial, cupom, checkout, lifecycle e elegibilidade são autoritativos no backend de billing; o retorno do navegador nunca concede acesso por si só.

## Fluxo implementado: WhatsApp para site

1. O webhook recebe mensagem de um telefone de origem.
2. O wrapper inicial consulta se existe usuário vinculado ao telefone.
3. Quando não existe usuário, o sistema cria ou reaproveita um lead em `whatsapp_onboarding_leads`.
4. O lead recebe status `pending_onboarding` e token randômico armazenado apenas como hash.
5. O WhatsApp responde com botão para `/onboarding/whatsapp/:token`.
6. A página pública valida o token antes de exibir o formulário.
7. O site coleta dados de acesso, perfil nutricional e consentimentos obrigatórios.
8. Ao concluir, o backend reivindica o token por atualização condicional e muda o lead para `converting`.
9. Somente uma requisição pode reivindicar um token pendente e não expirado. Requisições concorrentes recebem resposta de conclusão em andamento.
10. O backend cria a conta local e registra imediatamente `converted_user_id`, antes das demais etapas recuperáveis.
11. Perfil, vínculo WhatsApp e consentimentos são gravados por operações idempotentes.
12. Em falha antes da criação da conta, o lead volta a `pending_onboarding`; em falha posterior, permanece `converting` associado à conta e pode ser retomado sem criar outro usuário.
13. O backend consulta `getUserEntitlements(userId)`.
14. A procedure retorna `eligibility`, `nextAction`, `resumed` e `commercial`, onde `commercial` reutiliza o mesmo read model autoritativo de `/billing`:
    - `continue`, quando existe uma origem válida de acesso;
    - `await_activation`, quando o cadastro foi concluído, mas o uso protegido ainda não está liberado;
    - `resumed = true`, quando a tentativa recuperou uma conclusão interrompida depois da criação da conta;
    - `commercial` contém origem efetiva, assinatura/lifecycle, reconciliação, catálogo, trial elegível e ações comerciais permitidas pelo backend; se esse read model estiver temporariamente indisponível, retorna `null` sem desfazer cadastro ou vínculo.
15. A página redireciona o usuário liberado para o onboarding normal ou o usuário pendente para `/billing`, que pode repetir a leitura comercial autenticada sem reutilizar o token de onboarding.

O estado persistido acompanha a situação real:

- `pending_onboarding`: token disponível para conclusão;
- `converting`: token consumido e conclusão em andamento ou recuperável;
- `pending_activation`: conta, perfil, vínculo e consentimentos concluídos, mas sem origem comercial válida;
- `active`: elegibilidade confirmada e onboarding ativado;
- `expired` ou `canceled`: fluxo encerrado sem conversão válida.

A migration `0039_whatsapp_onboarding_activation.sql` adiciona os estados de conversão/ativação, a origem da ativação, a data de ativação e um código sanitizado para recuperação operacional.

## Conta existente e retomada autenticada

Quando o e-mail informado na conclusão pública já pertence a uma conta, a procedure não confirma publicamente que a conta existe. Ela retorna uma orientação genérica e devolve o lead para `pending_onboarding`, preservando o mesmo token enquanto ele continuar válido.

A continuação ocorre por `auth.whatsappOnboarding.linkExistingAccount({ token })` e exige simultaneamente:

1. sessão autenticada da conta que receberá o vínculo;
2. token opaco recebido no telefone pelo WhatsApp, usado como prova de posse do canal;
3. lead pendente, não expirado e ainda não associado a outra conta;
4. ausência de vínculo ativo do mesmo telefone com outro usuário.

No banco, o lead é bloqueado por `FOR UPDATE`; claim do token, verificação de conflito, ativação ou criação da conexão em `whatsappConnections` e associação de `converted_user_id` são executados na mesma transação. A chave única do telefone no lead serializa tentativas concorrentes do mesmo número. Repetição pelo mesmo usuário é idempotente; tentativa por outra conta retorna resposta genérica e não troca o vínculo.

Esse caminho não cria nova conta, perfil, trial, transição, assinatura ou entitlement. O perfil, o histórico nutricional, a elegibilidade e os consentimentos válidos da conta autenticada não são sobrescritos. Depois do vínculo, a elegibilidade central define `continue` ou `await_activation`, a resposta inclui o mesmo snapshot comercial autenticado e a saudação continua protegida pelo contrato de envio único.

## Contratação e continuidade comercial

Usuário em `pending_activation` segue para **Plano e acesso** sem perder cadastro, perfil, consentimentos ou vínculo WhatsApp.

A tela `/billing` consome exclusivamente o backend para catálogo, versão, preço, ciclo, capacidade, meios permitidos, cupom, trial, checkout e estado de reconciliação. O frontend não cria assinatura fictícia nem decide ativação por mensagem local.

Contratos vigentes:

- Individual: trial de 7 dias somente com cartão previamente cadastrado/validado pelo fluxo seguro;
- Profissional: trial de 14 dias somente com cartão, matriz pessoal + profissional e capacidade inicial de 5 pacientes durante o trial;
- Pix Automático inicia contratação paga sem trial e exige renúncia explícita ao período de avaliação;
- apenas um cupom elegível por contratação; cupom não é origem de acesso;
- desconto público de 100% não é checkout gratuito e depende de isenção administrativa;
- callback/retorno do navegador permanece pendente até confirmação financeira autoritativa;
- retries, múltiplas abas e troca de meio reaproveitam as garantias de idempotência do billing, sem consumir cupom ou criar contratação em duplicidade.

## Ativação comercial posterior

`activateWhatsappOnboardingUser(userId, source)` é a orquestração idempotente usada depois que uma condição válida surge.

Ela:

1. consulta novamente o serviço central de elegibilidade;
2. recusa ativação quando `allowed = false`;
3. localiza o lead convertido pelo usuário;
4. muda `pending_activation` para `active` por atualização condicional;
5. registra `activation_source` e `activated_at`;
6. dispara a saudação idempotente, sem reverter a ativação se o envio falhar.

Uma liberação administrativa chama essa mesma orquestração depois de persistir o override. A rota protegida `billing.refreshOnboardingActivation` permanece como recuperação manual autenticada na página **Plano e acesso**.

A integração da #215 também executa `reconcilePendingWhatsappOnboardingActivations()` depois das transições autoritativas do lifecycle de billing: início de contrato/trial, fatos financeiros, ticks e processamento de fatos pendentes, após a reconciliação de cobertura profissional quando aplicável. O reconciliador faz uma varredura limitada de leads `pending_activation` e chama a mesma orquestração central para cada usuário. Ele nunca infere acesso a partir de callback, checkout ou payload do provider. Chamadas repetidas e concorrentes convergem pela atualização condicional `pending_activation -> active` e pelo contrato idempotente da saudação.

Falha nessa reconciliação é recuperável: não desfaz pagamento, trial, assinatura, cobertura, cadastro ou vínculo. O lead permanece pendente e pode ser reavaliado por evento posterior, processamento periódico ou `billing.refreshOnboardingActivation`.

## Precedência de elegibilidade

Em `enforced`, a origem efetiva é selecionada no backend pela política central, preservando origens secundárias válidas:

1. isenção administrativa;
2. cobertura profissional;
3. assinatura própria paga;
4. trial;
5. período de transição;
6. acesso somente para leitura.

`open_access` permanece o padrão de rollout até a ativação progressiva governada pela #898. Cupom, checkout pendente, retorno do navegador e estado local do frontend não são fontes de acesso.

## Bloqueio pré-pipeline no WhatsApp

Depois de localizar um usuário pelo telefone e antes de executar qualquer fluxo nutricional, `whatsappImageIdempotencyWebhook.ts` consulta o serviço central de elegibilidade.

Quando `allowed = false`:

- a mensagem não chega ao pipeline de texto, imagem ou áudio;
- nenhuma refeição, água, exercício ou confirmação é persistida;
- o usuário pendente não é tratado como telefone desconhecido e não recebe novo onboarding;
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

No onboarding iniciado pelo WhatsApp, a saudação só é disparada quando a elegibilidade central está liberada. Falha de envio não altera a decisão comercial nem apaga cadastro, consentimentos ou vínculo. Uma nova tentativa retoma apenas as partes ainda não entregues da mensagem.

Mensagem enviada:

> Olá, {nome}! Obrigado por se cadastrar no Controle de Calorias. Salve este número para registrar suas refeições, água e exercícios pelo WhatsApp sempre que precisar.

## Fora de escopo desta etapa

- Ativar `BILLING_ACCESS_MODE=enforced` ou executar coortes de rollout; isso pertence à #898.
- Confirmar pagamento pelo retorno do navegador.
- Criação de conta completa apenas com a primeira mensagem no WhatsApp.
- Disparos ativos de marketing fora das políticas/campanhas autorizadas.
- Alteração livre de telefone quando já existe vínculo WhatsApp ativo para o usuário.
- Duplicar no onboarding regras comerciais já pertencentes a catálogo, Asaas, lifecycle, cobertura ou administração de billing.

## Segurança e privacidade

- O token não contém telefone nem dados pessoais em claro.
- O token é armazenado como SHA-256 e expira em 24 horas.
- O consumo usa atualização condicional; somente uma conclusão pendente pode vencer.
- O telefone exibido na página pública é mascarado.
- A conclusão pública não informa se o e-mail pertence a uma conta existente.
- O vínculo com conta existente exige sessão autenticada e o token recebido pelo próprio WhatsApp.
- Conflito de telefone ou de conta retorna resposta genérica, sem identificar o usuário associado.
- O telefone informado na aba Perfil é tratado como dado pessoal sensível para logs e mensagens de erro.
- O fluxo exige aceite de termos, política de privacidade, tratamento de dados necessários ao serviço e comunicação operacional pelo WhatsApp.
- Marketing pelo WhatsApp é opt-in separado e opcional.
- A saudação web exige consentimento operacional específico antes do envio.
- Logs do serviço usam telefone mascarado nos eventos novos do onboarding.
- A resposta pública anterior à autenticação não informa plano, dívida, valor ou motivo financeiro detalhado.
- O snapshot `commercial` só é retornado depois da criação da sessão da nova conta ou em procedure já protegida para conta existente.
- O reconciliador automático não registra token, telefone, conteúdo de mensagem, dados de saúde ou payload bruto de provider.
- `completion_error_code` usa vocabulário fechado; mensagens de exceção, e-mail, telefone, senha e token nunca são persistidos nesse campo.

## Persistência

Tabela: `whatsapp_onboarding_leads`.

Campos principais:

- `phone_number`: telefone normalizado;
- `display_name`: nome vindo do canal quando disponível;
- `origin`: origem do lead, inicialmente `whatsapp`;
- `status`: estado do lead, conversão e ativação;
- `token_hash`: hash do token opaco;
- `token_expires_at`: expiração do link;
- `token_used_at`: claim único do link;
- `converted_user_id` e `converted_at`: vínculo com o usuário convertido;
- `activation_source` e `activated_at`: fonte e momento da ativação comercial;
- `completion_error_code`: código sanitizado e pertencente ao vocabulário fechado da última falha recuperável;
- `last_message_at`: atualização operacional para mensagens repetidas do mesmo telefone.

A compatibilidade de runtime apenas verifica a estrutura em produção. Mudanças estruturais devem ser aplicadas por migrations versionadas antes do deploy. A #215 não adiciona migration: ela compõe estados e contratos já existentes.

A saudação do onboarding web usa `userPreferences` com a chave `whatsapp_web_greeting_status`. A mensagem de boas-vindas completa usa `whatsapp_welcome_v2_status` e registra a quantidade de mensagens já entregues para permitir retry seguro.

## Contratos públicos

Rotas tRPC públicas em `auth.whatsappOnboarding`:

- `validate({ token })`: valida o token e retorna telefone mascarado, status e expiração;
- `complete({ token, email, password, profile, consents })`: cria ou retoma uma conta nova, salva onboarding, vincula WhatsApp, inicia sessão e retorna `{ user, eligibility, nextAction, resumed, commercial }`; conflito com conta existente usa resposta genérica e mantém o token retomável.

Rotas tRPC protegidas:

- `auth.whatsappOnboarding.linkExistingAccount({ token })`: associa transacionalmente o telefone provado pelo token à conta autenticada, sem sobrescrever perfil, histórico ou consentimentos, e devolve também `commercial`;
- `billing.webOverview`: read model autoritativo de origem efetiva, assinatura/lifecycle, reconciliação, catálogo, trial e ações comerciais permitidas;
- `billing.subscriptionStatus`: consulta a origem efetiva, assinatura própria e capacidade profissional sem depender da liberação dos demais recursos;
- `billing.refreshOnboardingActivation`: reavalia a elegibilidade e conclui uma ativação pendente sem confiar em estado do cliente;
- `auth.sendWhatsappGreeting({ acceptedOperationalWhatsapp })`: envia ou registra skip da saudação inicial para usuário logado com WhatsApp vinculado;
- `nutrition.whatsapp.upsertConnection({ phoneNumber, displayName })`: vincula o telefone do usuário final à conta logada e impede uso do número oficial da solução como telefone pessoal.

`auth.whatsappOnboarding.linkExistingAccount` é a única exceção de onboarding autenticado à policy de billing enquanto o acesso comercial estiver pendente. Rotas com prefixo ou nome semelhante não são liberadas.

## Validação

- Telefone novo no webhook cria/reaproveita lead e não processa refeição.
- Token válido abre a página pública e mostra telefone mascarado.
- Token inválido, expirado ou usado mostra estado de erro amigável.
- Duas conclusões concorrentes não criam duas contas.
- Falha posterior à criação da conta pode ser retomada sem registrar outro usuário.
- Conflito com conta existente não revela publicamente se o e-mail está cadastrado e mantém o token válido para retomada.
- Uma conta autenticada pode consumir o token e vincular o telefone exatamente uma vez.
- Duas contas concorrentes não conseguem consumir o mesmo lead nem trocar o usuário convertido.
- Telefone já vinculado a outro usuário produz erro público genérico e nenhuma mutação parcial.
- O vínculo de conta existente não sobrescreve perfil, metas, histórico ou consentimentos.
- Mensagem de exceção com e-mail, telefone ou token é reduzida a `ONBOARDING_COMPLETION_FAILED` antes da persistência.
- Cadastro sem consentimentos obrigatórios é recusado.
- `open_access` conclui o cadastro, retorna `continue` e envia a saudação uma única vez.
- Elegibilidade negada persiste `pending_activation`, retorna `await_activation` e não envia saudação.
- Resposta de conclusão/vínculo inclui o read model comercial do backend sem tornar falha de leitura comercial uma falha de cadastro.
- Override vigente ou outra origem válida ativa o mesmo lead uma única vez.
- Trial, confirmação financeira, recuperação ou cobertura profissional que tornam o usuário elegível acionam a mesma reconciliação idempotente de `pending_activation`.
- Callback de navegador, checkout apenas criado ou mensagem local de frontend não ativam o lead.
- Falha do reconciliador não reverte o fato comercial e permite retry posterior.
- Usuário pendente que envia texto, imagem, áudio, água, exercício ou confirmação não produz efeito nutricional em `enforced`.
- Usuário elegível continua no fluxo normal de refeição, hidratação e comandos.
- Onboarding web exibe a opção de saudação apenas quando houver telefone WhatsApp vinculado.
- Salvar Perfil com telefone novo persiste o vínculo com o código do país selecionado e tenta enviar a saudação inicial uma única vez.
- Saudação web não é enviada sem consentimento operacional.
- Saudação web registra status e evita duplicidade depois de envio concluído.