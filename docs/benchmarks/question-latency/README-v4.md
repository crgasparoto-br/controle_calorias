# Protocolo v4 — QUESTION end-to-end

O benchmark `question-latency/end-to-end-productive-pipeline-hermetic-v4` compara `develop` e o material head sobre a mesma coorte sintética, com os mesmos 30 fixtures da coorte versionada e duas observações por fixture em cada lado (60 execuções por lado). Baseline e candidato rodam sequencialmente para não contaminar percentis por contenção cruzada.

## Boundary produtivo

Cada observação abre o trace antes do lookup e atravessa, nesta ordem: `server/db.ts#getUserIdByWhatsappPhone`, `resolveWhatsAppOperationTimeZone`, persistência inbound, `executeWhatsappAiQuestionIntent`, delivery lógico, persistência outbound/link e `markProcessed`. DB/provider/delivery externos são doubles herméticos; os entrypoints produtivos acima executam em ambos os SHAs.

`total_ms` cobre esse boundary terminal. `db_ms` é cumulativo: inclui lookup de usuário, resolução persistida de timezone, histórico recente quando necessário e loaders de insights selecionados. O estágio de IA soma seus reads ao tempo preparatório já medido; não o sobrescreve.

## Trabalho opcional

Perguntas claramente genéricas (`scope=none`) devem executar **zero** I/O de histórico recente e não enviar histórico ao provider. Follow-ups/ambiguidades preservam o histórico. O harness verifica os dois ramos.

O estreitamento temporal também é conservador: `week` significa semana-calendário corrente, `last7Days` significa sete datas locais inclusivas terminando no dia da requisição, `month` significa mês-calendário corrente até a data local, e `period` preserva a janela móvel de 30 dias. Expressões que não identificam uma dessas janelas com segurança caem em `full`; uma janela mais barata nunca pode substituir um período semanticamente diferente.

## Gate

O candidato passa apenas se houver: no mínimo 60 sucessos por lado (2 repetições para cada um dos 30 fixtures); melhora >=20% em p90 ou p95; nenhuma regressão >5% em p50/p90/p95; erros/timeouts sem aumento; uma chamada de provider com web search disponível; lookup de usuário e timezone exatamente uma vez por caso; persistência terminal completa; `scope=none` sem histórico; e `db_ms` cobrindo reads preparatórios + contexto.

Execute `node scripts/issue-989-question-latency-benchmark-v4.mjs --base-sha <develop_sha> --candidate-sha <material_head_sha> --typescript-path <typescript_module> --out <result.json>`.

A evidência é sintética, sem PII, e só vale quando `candidateSha` é exatamente o material head congelado.
