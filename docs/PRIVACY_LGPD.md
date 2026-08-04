# Privacidade e LGPD

## Objetivo

Este documento resume os dados pessoais tratados pelo Controle de Calorias e os cuidados mínimos esperados em desenvolvimento, suporte e operação.

## Papéis e superfícies do produto

O modelo completo de experiência está em `docs/product-specs/product-experience-model.md`.

- Na Área do Paciente, o usuário trata seus próprios dados de alimentação, saúde, metas, peso, exercícios, mensagens e integrações.
- Na Área Profissional, o nutricionista pode atuar como usuário autenticado e acessar dados de pacientes somente mediante perfil profissional ativo, vínculo vigente, consentimento e escopo autorizado.
- O mesmo paciente pode usar o produto de forma independente ou vinculado a um profissional.
- A existência de perfil profissional adicional não cria uma segunda identidade nem transfere automaticamente dados pessoais ou de saúde.
- Billing, assinatura ou entitlement não substituem autorização de acesso a dados.

### Responsabilidade do profissional

Quando o profissional registra orientação, comentário, meta, sugestão ou mensagem relacionada ao paciente, o sistema deve manter separação entre:

- identidade e dados pessoais do profissional;
- dados pessoais e de saúde do paciente;
- autoria da ação;
- origem manual, automática ou sugerida pela IA;
- data, vigência, justificativa e histórico aplicável.

O produto não deve misturar dados pessoais do nutricionista ao prontuário, relatório ou exportação do paciente além do necessário para autoria e prestação do serviço.

## Inventário de dados

| Categoria | Exemplos | Finalidade |
|---|---|---|
| Conta | nome, e-mail, role | autenticação e identificação |
| Perfil nutricional | altura, idade, sexo, objetivo, peso | cálculo e acompanhamento |
| Alimentação | refeições, porções, macros, texto original | registro e relatórios |
| Mídia | fotos, áudios e metadados | inferência multimodal e revisão |
| Derivados de mídia | PNG anotado local/externo, chave de storage e estado do artefato | apoio visual opcional sem substituir o original |
| Conversa | telefone, mensagens e contexto WhatsApp | operação conversacional |
| Integrações | credenciais e tokens Strava/WhatsApp | conexão com serviços externos |
| Profissional | perfil, CRN opcional, vínculos, comentários e sugestões | acompanhamento por nutricionista |
| Acompanhamento clínico | metas oficiais, janelas de vigência, justificativas, histórico e orientações | condução e auditoria do acompanhamento nutricional |
| Logs | ação, entidade, ator e erro sanitizado | suporte e auditoria |

## Dados sensíveis

Dados de saúde e alimentação devem ser tratados como sensíveis. Isso inclui:

- texto de refeição;
- fotos de alimentos;
- áudio e transcrição;
- restrições alimentares e condições de saúde;
- peso, idade, altura e metas;
- comentários e sugestões profissionais;
- metas oficiais definidas por profissional;
- histórico de ajustes e justificativas;
- métricas detalhadas de atividades do Strava, como distância, duração, elevação, frequência cardíaca, cadência, potência, equipamento, visibilidade e interação social;
- vínculo e consentimento entre paciente e profissional.

## Princípios

- **Minimização**: enviar a provedores apenas o necessário.
- **Finalidade**: coletar somente para funcionalidades explícitas.
- **Segurança**: manter segredos e processamento sensível no backend.
- **Transparência**: distinguir conteúdo do paciente, do profissional e sugestão da IA.
- **Controle**: permitir exportação e exclusão de conta.
- **Autorização**: compartilhar dados profissionais apenas mediante vínculo e escopo vigentes.
- **Revogabilidade**: permitir que o paciente encerre o compartilhamento futuro.
- **Rastreabilidade**: registrar autoria e histórico para alterações profissionais relevantes.

## Compartilhamento e vínculo profissional

- O paciente inicia ou aceita o compartilhamento conforme o fluxo de produto.
- O profissional não pode descobrir dados de saúde apenas por conhecer e-mail, telefone ou identificador do paciente.
- Solicitação de acesso não autoriza leitura de dados.
- O backend valida perfil profissional ativo, vínculo aprovado, não revogado e escopo aplicável em cada leitura ou mutação.
- A UI não deve manter dados do paciente anterior após troca de contexto ou revogação.
- Revogação bloqueia novos acessos e comunicações, preservando apenas histórico legal/auditável quando necessário.
- Mensagens, comentários, metas e sugestões devem indicar autoria e não podem ser atribuídos automaticamente ao paciente.
- Sugestões da IA não podem ser aplicadas como decisão clínica sem confirmação explícita do profissional autorizado.

## Não enumeração em solicitações de acesso

- A solicitação aceita somente e-mail ou telefone normalizados e responde sempre com a mesma mensagem pública, sem nome, contato, `patientUserId`, objeto de paciente, confirmação de existência, erro de entrega ou indicação de solicitação já aberta.
- Toda tentativa aceita cria um comprovante opaco `pending` em `professionalHistoryEvents`, sem o contato solicitado. O comprovante não autoriza acesso e não é sinônimo de conta existente.
- Repetir a solicitação produz novo comprovante opaco, sem alterar resposta, quantidade, ordem ou shape de resultados que permitam inferência.
- `myAccesses`, carteira, histórico e qualquer busca auxiliar não podem expor a associação entre comprovante e autorização antes de o vínculo estar `approved`.
- A associação interna serve exclusivamente para o paciente dono decidir a solicitação; auto-solicitação nunca cria autorização, mesmo que a resposta pública continue uniforme.
- A busca identificável da carteira retorna somente vínculos `approved`. Comprovantes sem vínculo resolvido expiram após trinta dias.
- Rate limit por profissional e janela de tempo é obrigatório. Telemetria de abuso usa apenas hashes efêmeros e metadados operacionais sanitizados.

## Provedores de IA

### OpenAI

A migração do fluxo principal deve minimizar dependência de terceiros desnecessários.

Regras:

- usar somente o backend para chamadas;
- não enviar IDs internos quando não forem necessários;
- não logar prompts ou respostas completas;
- não manter áudio ou imagem além do necessário para a funcionalidade;
- documentar qualquer retenção configurada no provedor;
- aplicar fallback que preserve o fluxo sem expor dados adicionais;
- não permitir que mudança de provider global redirecione silenciosamente o segundo envio da foto para anotação.

### Gemini

Enquanto houver suporte ao Gemini como provider de inferência nutricional:

- tratar foto e texto de refeição como dados sensíveis;
- manter chave somente no backend;
- evitar incluir e-mail, telefone ou IDs internos no prompt;
- manter a confirmação da refeição independente do provider;
- documentar fallback e desligamento antes da remoção futura.

### Seleção por capacidade (#921)

- `server/_core/ai/` registra somente capacidades conhecidas e operações implementadas no adapter local. `openai-compatible` não herda suporte implícito: cada operação externa precisa constar em `AI_OPENAI_COMPATIBLE_OPERATIONS`.
- Provider é resolvido antes do modelo, e o executor recebe provider/modelo/adaptador já vinculados. Uma variável global ou o nome do modelo não podem redirecionar a chamada para outro provider.
- Variáveis novas por capacidade prevalecem sobre compatibilidade legada; o uso de legado produz somente diagnóstico sanitizado.
- Campos de request não suportados são rejeitados antes da rede. Mídia, ferramenta ou schema nunca podem ser descartados silenciosamente pelo adapter.
- `raw` do SDK é removido na fronteira `_core`; consumidores recebem somente resultado normalizado e metadados de uso numéricos permitidos.
- Estados `disabled`/`invalid`, operação incompatível, timeout/tentativas inválidos e fallback incompleto falham antes da criação da chamada.
- Fallback é desabilitado por padrão e isolado por capacidade. Provider diferente exige opt-in explícito da capacidade fora de produção e continua inelegível em produção até benchmark, revisão de privacidade/LGPD e rollout aprovados na #927.
- O modelo de fallback pertence ao provider de destino. O modelo primário não é reutilizado silenciosamente em provider diferente.
- `AbortSignal` é propagado até o SDK. Retry/fallback só começa depois que a chamada anterior encerra; provider que ignora cancelamento faz a execução falhar fechado, sem um segundo envio. O sinal não garante que o provider remoto interrompa processamento ou cobrança.
- Cada tentativa contém exatamente uma operação externa da capacidade; existe no máximo uma chamada posterior de fallback, sem cadeia ou retorno ao primário.
- Diagnósticos, erros e metadados de execução nunca incluem mídia, base64, prompt, schema de entrada com dados, resposta completa, chave, token ou mensagem bruta do provider.
- Escalonamento de qualidade é política separada e não pode ser ativado implicitamente por fallback ou modo degradado.
- Qualquer mudança de provider, endpoint, operação, ferramenta ou combinação por modelo exige atualizar `ARCHITECTURE.md`, `.env.example`, `docs/RELIABILITY.md`, `docs/SECURITY.md` e este inventário antes do rollout.

### `TRANSCRIPTION` (#924)

- Áudio do WhatsApp é deduplicado antes do download e da transcrição; callback duplicado não repete envio, custo nem mutação.
- URL/base64, MIME, tamanho e arquivo vazio são validados antes da criação do adapter.
- O baseline é `openai` + `whisper-1`; fallback permanece desabilitado por padrão e cross-provider é bloqueado em produção até a #927.
- O request para o provider contém somente bytes, nome técnico do arquivo, MIME e opções de transcrição. ID interno, telefone, mensagem bruta e metadados desnecessários não fazem parte do contrato.
- A resposta de domínio exige texto e mantém `language`, `duration`, `segments` e `usage` opcionais. `raw` e campos adicionais do SDK são descartados antes de chegar a web, WhatsApp ou benchmark.
- Logs registram apenas provider, modelo, origem normalizada, tentativas, duração, presença de texto/metadados e código de falha sanitizado. Áudio, transcrição, prompt, base64, URL assinada e erro bruto são proibidos.
- O benchmark usa seis fixtures sintéticos, execução sequencial, uma tentativa, sem fallback e saída sanitizada. Resultados locais brutos ficam em diretório ignorado pelo Git e não podem ser commitados.

### `IMAGE_ANNOTATION` (#925)

- O modo `local` é o default e não envia foto, prompt ou dados nutricionais a provider de imagem. Ele valida a mídia, auto-orienta uma cópia e compõe uma camada determinística, preservando os bytes originais.
- O modo `external` representa um tratamento adicional e um novo envio da foto ao provider específico da capacidade. Só pode ocorrer com configuração explícita e executável de `AI_IMAGE_ANNOTATION_*`.
- `AI_VISION_PROVIDER`, `AI_MEAL_VISION_PROVIDER`, `OPENAI_MODEL`, `GEMINI_MODEL` e a seleção usada para inferência não autorizam nem redirecionam a anotação externa.
- A foto original e o PNG derivado usam buffers e chaves de storage distintos. Falha ao gerar, armazenar ou enviar o derivado não remove nem substitui o original.
- Um resumo visual sem a foto original é outro artefato e não pode ser apresentado como anotação.
- Fallback externo é desabilitado por padrão. Provider diferente exige opt-in específico e permanece bloqueado em produção até benchmark, análise de transferência internacional, revisão LGPD e rollout aprovados na #927.
- A degradação `external -> local` só ocorre com `AI_IMAGE_ANNOTATION_EXTERNAL_FAILURE_MODE=local`; não constitui fallback externo e não adiciona outro compartilhamento.
- Logs e telemetria registram apenas modo, degradação, origem normalizada, tentativas, tipo do artefato e código de falha sanitizado. Foto, base64, URL assinada, prompt, conteúdo nutricional, resposta bruta, segredo e mensagem do SDK são proibidos.
- Original e derivado devem ser incluídos de forma independente na exportação e exclusão de dados e seguir a política de retenção aplicável às mídias da refeição.

## Strava

- OAuth usa backend.
- Tokens ficam criptografados.
- Eventos de webhook são idempotentes.
- Apenas dados necessários ao exercício são persistidos.
- O ID externo da atividade é tratado como referência opaca para idempotência e não deve ser exposto fora do contexto do próprio usuário.
- Atividades privadas ou marcadas como Only Me só podem ser importadas quando o usuário reconectar e conceder `activity:read_all`.
- Métricas opcionais, como frequência cardíaca, cadência, potência, equipamento, visibilidade e contadores sociais, só devem ser persistidas quando retornadas pela API e nunca devem aparecer em logs, analytics ou respostas de outro usuário.
- Calorias estimadas por MET para treino de força devem ser identificadas como estimativas, preservando transparência no relatório e no detalhe do exercício.
- O usuário pode desconectar e excluir a conta, removendo dados e segredos vinculados conforme a política de exclusão.

## WhatsApp

- O telefone do usuário serve para resolução de identidade no canal.
- O número oficial da solução é o único canal de resposta.
- Mensagens e mídias não devem ser logadas integralmente.
- Tokens devem ficar criptografados e restritos ao backend.
- A imagem anotada é auxiliar; falha local, externa, de upload ou de envio não bloqueia registro, resposta textual ou preservação do original.
- O canal não pode enviar cartão-resumo como se fosse uma anotação quando a foto original estiver ausente ou inválida.

## Logs e observabilidade

Pode ser registrado:

- `userId` interno quando necessário;
- tipo de ação;
- status;
- duração;
- código de erro sanitizado.

Não deve ser registrado:

- senha;
- hash de senha;
- token;
- cookie;
- áudio bruto;
- base64 de imagem;
- texto cru da refeição;
- transcrição completa;
- prompt de IA;
- resposta completa de IA;
- erro bruto de SDK;
- URL assinada;
- mensagem WhatsApp completa;
- telefone completo;
- comentário ou orientação clínica completa;
- metadados detalhados do Strava associados ao usuário.

## Exportação

A exportação deve incluir dados do próprio usuário em formato legível. Quando houver vínculo profissional, deve distinguir:

- dados fornecidos pelo paciente;
- conteúdo criado pelo profissional;
- sugestões da IA;
- histórico de vínculo, consentimento e revogação;
- foto original e derivados visuais associados, com identificação do tipo de artefato.

## Exclusão

A exclusão deve remover ou anonimizar:

- conta;
- perfil;
- refeições e itens;
- fotos, áudios e derivados visuais;
- pesos, exercícios e metas;
- integrações e tokens;
- mensagens e contexto conversacional quando aplicável;
- vínculos e acessos futuros.

Históricos profissionais que precisem ser preservados por obrigação legal ou contratual devem ser separados, minimizados e documentados. O vínculo revogado não pode continuar autorizando acesso operacional.

## Retenção

- Definir prazo por categoria.
- Evitar retenção indefinida de mídia.
- Expurgar logs operacionais em prazo curto.
- Manter auditoria profissional somente pelo período necessário.
- Documentar exceções regulatórias ou contratuais.
- O derivado de imagem não herda permanência adicional: segue o prazo da mídia vinculada e deve ser removido sem afetar a integridade do original já excluído ou exportado.

## Checklist para novas features

- Qual dado é coletado?
- É necessário?
- Quem pode acessar?
- Há vínculo e consentimento quando o acesso é profissional?
- O paciente pode revogar?
- O dado distingue paciente, profissional e IA?
- O dado será enviado a terceiro?
- A mudança de provider ou modo pode criar novo envio da foto?
- Existe alternativa local que reduza compartilhamento?
- Por quanto tempo será mantido?
- Entra em exportação?
- Entra em exclusão?
- Pode aparecer em logs?
