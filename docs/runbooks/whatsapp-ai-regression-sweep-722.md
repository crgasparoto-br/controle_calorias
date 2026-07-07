# Varredura de regressões WhatsApp/IA — #722

## Escopo coberto

Esta evidência consolida a varredura focada após os ajustes recentes no fluxo WhatsApp/IA.

## Regressões tratadas

### Relatórios por período relativo

Coberto pela PR #725.

- `Relatório semana passada` resolve a semana calendário anterior completa.
- `Resumo semana passada` resolve a semana calendário anterior completa.
- `Relatório semana anterior` resolve a semana calendário anterior completa.
- `Relatório esta semana` mantém a semana atual.
- `Relatório últimos 7 dias` mantém janela móvel.
- `Relatório mês passado` mantém mês calendário anterior completo.

### Registro textual com typo/acento

Coberto por esta entrega.

Casos positivos automatizados:

- `1 maça fugi` -> `1 un maçã fuji`.
- `1 maca fuji` -> `1 un maçã fuji`.
- `uma maca` -> `1 un maçã`.
- `100g maça fugi` -> `100 g maçã fuji`.
- `1 banana prata` -> `1 un banana prata`.
- `2 ovos cozido` -> `2 un ovos cozidos`.

Casos de controle automatizados:

- `olá` não cria refeição.
- `bom dia` não cria refeição.
- `teste` não cria refeição.

## Causa provável

A regressão de `1 maça fugi` ocorria antes do processamento nutricional: o roteador recebia uma mensagem curta sem unidade explícita reconhecida e sem palavra alimentar cadastrada no dicionário curto, então retornava resposta segura em vez de deixar a mensagem chegar ao fallback nutricional.

A correção normaliza variações curtas conhecidas antes do roteamento e também aplica a mesma normalização no fallback heurístico, preservando guardrails para mensagens conversacionais.

## Privacidade

Os testes usam apenas frases fixas de regressão e não registram telefone completo, prompt, reasoning, payload bruto, transcrição ou texto real de usuário em artefato permanente.
