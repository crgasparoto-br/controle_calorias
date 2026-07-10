# Matriz de regressão do contexto conversacional do WhatsApp

Issue: #768. Esta matriz é o gate de promoção do contexto persistente criado em #763–#767.

## Regras de execução

- Os cenários devem atingir os entrypoints reais: `handleWhatsAppIntentWebhook`, `handleWhatsAppWebhook` e `handleWhatsAppAnnotatedImageWebhook` conforme o tipo de payload.
- Reinício significa reconstruir serviços, repositórios e caches sobre o mesmo armazenamento persistente.
- Duas instâncias significa usar dois processadores independentes sobre o mesmo banco.
- A resposta esperada deve ser verificada junto com mensagens, vínculos de domínio, pendências, logs e ausência de duplicação.
- Conteúdo de mensagem, telefone, URL temporária, token ou segredo não pode aparecer em métricas/logs de observabilidade.

## Matriz funcional

| Cenário | Entrada | Continuação | Evidência obrigatória |
|---|---|---|---|
| Texto → texto | `100g arroz e 120g frango` | `e a proteína?` | mesma conversa, resposta consulta dados persistidos, nenhuma nova refeição |
| Texto explícito | `qual meu total de hoje?` | — | funciona sem depender de histórico |
| Texto → imagem | registro textual | foto complementar | ambos registrados na mesma conversa e com vínculos corretos |
| Imagem → texto | foto de refeição | `qual item tem mais calorias?` | resposta usa itens persistidos da imagem |
| Imagem + legenda → texto | foto com legenda | pergunta referencial | uma entrada multimodal lógica, sem duplicar legenda |
| Áudio → texto | áudio registrando jantar | `qual o total do jantar?` | origem áudio, transcrição sanitizada e resposta sobre o registro atual |
| Texto → áudio | registro textual | áudio corrigindo quantidade | correção resolve o item atual ou pede clarificação |
| Multicanal longo | texto → imagem → áudio | `agora quanto ficou?` | continuidade única e valores consultados no banco |
| Pergunta `/` | registro alimentar | `/como está minha proteína hoje?` | pergunta participa do histórico e não persiste alteração |
| Consulta → correção | consulta de refeição | correção explícita | revalidação do alvo no banco antes da mutação |
| Correção → consulta | correção de quantidade | `agora quanto ficou?` | resposta usa valor corrigido, não valor antigo do resumo |
| Seleção/confirmação | dois itens semelhantes | `o segundo` → `sim` | pendência persistente e consumo único |
| Expiração | contexto antigo | `exclua o segundo` | pede esclarecimento, não executa ação |
| Sem contexto | primeira mensagem referencial | `e a proteína?` | clarificação segura, sem fallback alimentar |
| Imagem não reconhecida | mídia inválida/sem itens | nova pergunta | erro controlado e histórico auditável |
| Áudio não reconhecido | transcrição indisponível | nova mensagem | erro controlado, sem refeição falsa |
| Mídia atrasada | mensagem posterior chega antes do fim da mídia | conclusão da mídia | ordenação por `occurredAt` + `id`, sem associação incorreta |
| Mudança de data/refeição | almoço de ontem | jantar de hoje | referência não cruza dia/refeição sem indicação segura |
| Conteúdo bloqueado | prompt injection em texto/legenda/transcrição | pergunta posterior | conteúdo bloqueado não entra no resumo confiável |
| Retenção | histórico expira/é limpo | consulta de dados | dados nutricionais permanecem e referência vaga pede esclarecimento |

## Profundidade

Executar conversas com 2, 3, 4, 8, 10 e 20 turnos. Em 20 turnos, verificar:

- resumo progressivo criado com proveniência;
- janela recente respeitando orçamento;
- ausência de mensagens partidas;
- resumo anterior superado sem edição destrutiva;
- correção posterior refletida pela consulta atual ao banco;
- falha do provedor de resumo caindo para janela recente + banco.

## Infraestrutura e concorrência

### Reinício

1. Processar a primeira mensagem.
2. Destruir instância do processador e caches locais.
3. Criar nova instância sobre o mesmo armazenamento.
4. Enviar pergunta referencial.
5. Confirmar continuidade sem repopular manualmente qualquer `Map`.

### Duas instâncias

1. Criar processadores A e B com objetos independentes.
2. A processa a entrada; B processa a continuação.
3. Repetir com duas confirmações concorrentes.
4. Confirmar consumo único da pendência, uma resposta funcional e nenhuma duplicação de domínio.

### Reentrega da Meta

Reentregar o mesmo `message.id` para texto, imagem e áudio. Confirmar uma mensagem, uma ação de domínio, no máximo uma resposta funcional e evento de duplicidade sem conteúdo sensível.

### Fora de ordem

Enviar mensagens com timestamps de ocorrência anteriores à última mensagem processada. Confirmar ordenação determinística por `occurredAt` e `id` e ausência de reordenação pelo momento de inserção.

### Falhas

Cobrir:

- armazenamento de contexto indisponível com domínio disponível;
- resumo lançando exceção ou retornando vazio;
- envio da Meta falhando após persistência bem-sucedida;
- usuário enviando nova mensagem antes da resposta anterior;
- falha no vínculo de domínio;
- retenção executada simultaneamente à leitura.

Nenhum cenário pode confirmar sucesso falso ou duplicar persistência nutricional.

## Comparação antigo x novo

Durante observação, registrar apenas metadados:

- quantidade de mensagens recuperadas por mecanismo;
- contexto ausente/expirado/truncado;
- divergência de alvo resolvido;
- necessidade de clarificação;
- latência de montagem;
- duplicidade detectada;
- falhas de persistência/resumo.

Não registrar o conteúdo comparado.

## Critérios de avanço do rollout

Avançar para a próxima etapa somente quando, na janela controlada definida pela operação:

- duplicações de refeição/água/peso/ação atribuíveis ao contexto = 0;
- ações ambíguas executadas sem confirmação = 0;
- divergências críticas entre contexto antigo e persistente = 0;
- falhas de contexto apresentam fallback seguro;
- latência não excede o orçamento operacional acordado para o ambiente;
- logs e métricas passam na revisão de privacidade;
- gates automatizados estão verdes.

## Rollback

- desativar leitura do contexto persistente por fluxo;
- manter gravação persistente ativa;
- preservar schema e dados já gravados;
- voltar à versão anterior compatível sem migration reversa;
- não remover tabelas, resumos ou vínculos durante incidente;
- reativar gradualmente após diagnóstico pelo runbook.

## Checklist de staging

- [ ] payload real representativo de texto;
- [ ] payload real representativo de imagem com e sem legenda;
- [ ] payload real representativo de áudio;
- [ ] alternância entre duas instâncias;
- [ ] reinício entre mensagens;
- [ ] reentrega do mesmo `message.id`;
- [ ] falha controlada de resumo;
- [ ] resposta da Meta falhando após persistência;
- [ ] logs sem conteúdo sensível;
- [ ] dados nutricionais inalterados após limpeza do histórico;
- [ ] rollback ensaiado sem downgrade de banco.

## Gates do repositório

```bash
pnpm check
pnpm test
pnpm architecture:check
pnpm docs:check
pnpm build
pnpm agent:check
```

A migration deve ser validada em banco compatível com TiDB. O teste manual controlado em staging é obrigatório antes da promoção para produção.