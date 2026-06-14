# Ajustes de registros pelo WhatsApp

## Contexto

A issue #399 melhora o tratamento de comandos como `era 150g`, `troca arroz por integral`, `remove frango` e `apaga o ultimo`.

Esses comandos nao devem cair no parser nutricional como novo alimento. Tambem nao devem alterar registros automaticamente enquanto o contexto multi-turn duravel da #420 e o padrao de selecao/confirmacao da #425 ainda nao estiverem completos.

## Primeira entrega

O modulo `server/modules/whatsapp/recordAdjustmentIntent.ts` atua como guard antes do fallback nutricional.

Ele reconhece:

- correcao de quantidade do ultimo item quando a ultima refeicao tem alvo unico;
- troca de alimento com alvo textual claro;
- remocao de item;
- remocao da ultima refeicao;
- comandos incompletos como `corrige isso`.

Quando encontra uma refeicao recente dentro da janela segura de 24 horas, ele responde com confirmacao ou lista de opcoes. Quando nao encontra alvo seguro, pede esclarecimento.

## Regras de seguranca

- Nenhuma alteracao e persistida automaticamente nesta etapa.
- Remocao de item ou refeicao sempre exige confirmacao.
- Troca e correcao de quantidade tambem exigem confirmacao antes de qualquer escrita.
- Multiplos candidatos geram opcoes estaveis para selecao.
- Sem refeicao recente ou alvo claro, o sistema pede uma nova instrucao.
- O pipeline registra a etapa `record_adjustment` no trace operacional.

## Limites atuais

- Confirmacoes ainda nao sao consumidas porque o estado pendente duravel pertence a #420/#425.
- Pendencia expirada sera tratada quando existir armazenamento de pendencias.
- A execucao real de update/remove fica para a etapa seguinte, depois que confirmacao e selecao estiverem padronizadas.
