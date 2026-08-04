# Segurança

## Mensagens profissionais

- A autorização aprovada é revalidada sob lock na mesma transação que persiste a mensagem web.
- Replays preservam o escopo da ação original: conclusão web não aciona WhatsApp; retry WhatsApp não cria nova mensagem.
- Retry manual só é permitido para entrega WhatsApp já falha; a capacidade vem do servidor e é revalidada sob lock, impedindo que um rascunho dispare a primeira entrega pelo endpoint de retry.
- Dados sensíveis e tokens não aparecem em `errorDetail` nem em logs estruturados.
- O paciente controla o canal WhatsApp por preferência, e o backend valida essa preferência antes da entrega.
- A resposta inbound valida o vínculo profissional e o ownership do identificador externo antes da persistência.
- Respostas inbound só são consideradas repetidas após violação de chave única e releitura do registro idempotente no mesmo vínculo; erro de banco, timeout ou indisponibilidade não pode ser convertido em confirmação falsa ao paciente.
- Revogação bloqueia novas mensagens imediatamente.
- O stream SSE de revogação exige sessão autenticada, valida perfil profissional e autorização aprovada antes de abrir a conexão e envia apenas `patientId` e timestamp. Desconexão, timeout e revogação removem listeners para evitar vazamento entre pacientes.

## Autenticação

- Sessões devem usar cookie HTTP-only.
- `secure` deve estar habilitado em produção.
- `JWT_SECRET` deve ser obrigatório em produção.
- Senhas devem ser armazenadas com hash forte; nunca em texto puro.
- O hash de senha nunca deve ser retornado para o frontend.

## Autorização

- Routers protegidos devem validar `ctx.user`.
- Procedures administrativas devem validar role explicitamente.
- Procedures profissionais devem validar perfil profissional ativo, vínculo vigente e escopo permitido.
- Leitura e mutação profissional devem separar `actorUserId` de `patientUserId`.
- A ausência de menu ou rota no frontend não é controle de autorização.
- Mudança de paciente no workspace exige nova validação de vínculo; contexto anterior não pode permanecer ativo.
- Dados pessoais do nutricionista não devem ser misturados ao prontuário ou relatório do paciente.

## Proteção contra enumeração em solicitações profissionais

- `requestAccess` aceita apenas e-mail ou telefone normalizados, usa uma resposta pública única e não retorna nome, contato, `patientUserId`, objeto de paciente, motivo, erro de entrega nem confirmação de existência.
- Alvo resolvido e não resolvido persistem o mesmo comprovante opaco `pending` em `professionalHistoryEvents`, sem o contato solicitado; o comprovante não constitui autorização.
- Cada tentativa aceita cria seu próprio comprovante. Repetição, ordem, total de resultados e histórico não podem distinguir conta existente, inexistente ou solicitação já aberta.
- A associação interna entre comprovante e autorização serve somente para o paciente dono validar a decisão; `myAccesses`, `portfolio`, `history` e buscas auxiliares não podem expor essa associação antes de `approved`.
- Reenvio da própria solicitação permanece aceito publicamente, mas nunca cria acesso a si mesmo.
- A busca identificável da carteira retorna somente vínculos `approved`; pendências usam recibo opaco e comprovantes sem vínculo resolvido expiram após trinta dias.
- Rate limit específico por profissional e janela de tempo é obrigatório, sem diferenças públicas entre tipos de alvo.
- Segurança, suporte e auditoria usam telemetria interna sanitizada; não se adiciona payload identificável às superfícies do profissional para facilitar diagnóstico.

## Segredos

- Chaves OpenAI, tokens WhatsApp, `JWT_SECRET`, credenciais Strava e `DATABASE_URL` ficam apenas no backend.
- Nunca expor segredo por `VITE_*`.
- Nunca registrar token, cookie, cabeçalho `Authorization` ou URL assinada em logs.
- O token de acesso do WhatsApp armazenado em `appSecrets.valueEncrypted` usa AES-256-GCM com uma chave dedicada quando `APP_SECRETS_ENCRYPTION_KEY` está configurada. Quando ausente, a leitura e escrita preservam compatibilidade com a chave legada derivada de `JWT_SECRET`; cada payload carrega um marcador de origem de chave (`keySource`) para que segredos antigos permaneçam legíveis durante a migração.
- A ausência de `APP_SECRETS_ENCRYPTION_KEY` não significa que segredos sejam armazenados em texto puro; significa que permanecem acoplados à rotação de `JWT_SECRET`. Configure a chave dedicada antes de rotacionar `JWT_SECRET`, ou reescreva primeiro todos os segredos legados (ex.: reconectar o WhatsApp).
- Falha de decriptação retorna erro sanitizado; valores de chave e conteúdo decriptado nunca são incluídos em logs.

## OpenAI

- Usar cliente oficial configurado exclusivamente no backend.
- Não enviar identificadores internos quando não forem necessários.
- Tratar foto, texto de refeição, áudio e transcrição como dados sensíveis.
- Sanitizar mensagens de erro antes de enviar ao cliente ou persistir em logs.
- Registrar apenas metadados operacionais mínimos.
- Validar schemas estruturados antes de usar a resposta da IA.
- Manter comportamento funcional mesmo quando recursos opcionais de IA estiverem indisponíveis.
- Na anotação de foto, o modo local padrão não envia mídia, prompt ou dados nutricionais a provider. O modo externo representa um novo envio e só pode ocorrer com `AI_IMAGE_ANNOTATION_MODE=external` e configuração executável da capacidade específica.
- Alterar `AI_VISION_PROVIDER`, `AI_MEAL_VISION_PROVIDER` ou o modelo de visão não autoriza nem redireciona o segundo envio da foto.
- O original e o derivado devem permanecer em buffers e chaves de storage distintos. Falha local, externa, de upload ou envio não pode sobrescrever ou remover o original.
- Logs da anotação registram apenas modo, degradação, número de tentativas, origem normalizada e código sanitizado; foto, base64, URL assinada, prompt, refeição, segredo e resposta bruta do SDK são proibidos.

## Fundação multi-provider por capacidade (#921)

- As capacidades de IA suportadas são declaradas em `server/_core/ai/capabilities.ts`; capacidades não registradas não devem ser ativadas por convenção de nome.
- A matriz de suporte representa somente operações efetivamente implementadas no adapter local. Em endpoints `openai-compatible`, nenhuma operação é presumida: `AI_OPENAI_COMPATIBLE_OPERATIONS` é uma allowlist obrigatória quando a capacidade exige rede.
- Provider é resolvido antes do modelo. `server/_core/ai/providerResolver.ts` recebe somente `AiProviderId` já validado e não consulta nome de modelo, variável global ou chave disponível.
- O executor recebe `ResolvedCapabilityConfig` e mantém provider/modelo/adaptador vinculados em cada tentativa. O callback não escolhe provider nem instancia adapters adicionais.
- Cada campo aceito pelo request comum deve ser traduzido integralmente ou rejeitado antes da rede. Ferramenta, mídia ou contrato Structured Output nunca podem ser descartados silenciosamente pelo adapter.
- `raw` de SDK não atravessa a fronteira `_core`; consumidores recebem apenas valores normalizados e metadados numéricos permitidos.
- `disabled`, `invalid`, timeout/tentativas inválidos, operação incompatível e fallback habilitado sem alvo executável falham antes da chamada externa.
- Fallback é desabilitado por padrão. Provider diferente exige opt-in específico por capacidade fora de produção e continua bloqueado em produção até benchmark, revisão de privacidade/LGPD e rollout aprovados na #927.
- Uma tentativa representa exatamente uma chamada outbound da operação da capacidade. Depois das tentativas primárias existe no máximo uma chamada de fallback; não há cadeia, probe ou retorno ao primário.
- Toda tentativa recebe `AbortSignal`. Retry ou fallback só começa depois de a chamada anterior encerrar; provider que ignora o cancelamento faz a execução falhar fechado sem segundo envio.
- Degradação funcional local, como anotação local, não é fallback de provider e não cria adapter externo.

## WhatsApp

- Validar assinatura/token de webhook.
- Deduplicar mensagens por identificador externo.
- Nunca logar payload completo da Meta em produção.
- Respostas devem usar o número oficial configurado.
- Dados do remetente devem ser minimizados e usados somente para resolver o usuário.
- Entrada de áudio deve ser deduplicada antes de download e transcrição; callback duplicado não pode baixar, transcrever ou mutar novamente.
- Falha ao produzir ou enviar imagem anotada não pode impedir a resposta textual nem o registro da refeição.

## Strava

- Tokens OAuth devem ser armazenados de forma criptografada e nunca retornados ao frontend.
- O webhook deve validar o challenge exigido pelo Strava e tratar callbacks de forma idempotente.
- A sincronização automática deve operar somente sobre vínculos conectados e persistidos.
- O escopo `activity:read_all` só deve ser solicitado para importar atividades privadas/Only Me quando o usuário reconectar e conceder o acesso.
- O ID externo da atividade deve ser preservado apenas como referência opaca suficiente para evitar duplicidade.
- Métricas detalhadas importadas do Strava, como frequência cardíaca, cadência, potência, equipamento, visibilidade e contadores sociais, são dados sensíveis e não devem aparecer em logs, analytics ou respostas de outros usuários.
- Falhas da API externa devem ser sanitizadas antes de chegar ao usuário ou aos logs.

## Banco e migrações

- Mudanças estruturais devem passar pelo `drizzle/schema.ts`.
- Migrations devem ser revisadas antes de deploy.
- Exclusões em cascata e `SET NULL` devem ser intencionais.
- Integridade referencial deve ser validada após mudanças críticas.

## Dados sensíveis

Consulte `docs/PRIVACY_LGPD.md` para o inventário completo.

Categorias críticas:

- refeições e restrições;
- peso, idade, altura e metas;
- fotos, áudio e transcrições;
- tokens de integrações;
- telefone e mensagens WhatsApp;
- comentários, sugestões, metas oficiais e justificativas profissionais;
- vínculo, consentimento e revogação entre nutricionista e paciente.

## Checklist de review

- [ ] Novo segredo foi adicionado apenas ao backend?
- [ ] Nova procedure valida autenticação e autorização?
- [ ] Nova procedure profissional valida ator, paciente e vínculo no backend?
- [ ] Nova mensagem profissional preserva consentimento, idempotência, vínculo e revogação?
- [ ] Novo log evita dados sensíveis?
- [ ] Nova tabela tem dono e lifecycle claros?
- [ ] Nova integração suporta falhas sem corromper o fluxo?
- [ ] Alteração na anotação mantém o modo local sem rede por padrão e exige opt-in para novo envio externo?
- [ ] Original e derivado continuam separados e exportação/exclusão cobrem ambos?
- [ ] `pnpm agent:check` foi executado?
