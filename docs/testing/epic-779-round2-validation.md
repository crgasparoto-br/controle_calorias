# Segunda rodada de validação da epic #779

Esta rodada alinha a suíte de regressão ao contrato final do WhatsApp e inclui duas correções funcionais adicionais identificadas pelo gate real:

- ambiguidades de substituição interpretadas pela IA seguem para seleção persistente, enquanto substituições claras permanecem automáticas após validação do backend;
- calorias de exercícios com o mesmo identificador externo são somadas uma única vez no cálculo central.

O commit final deve passar pelos gates oficiais do repositório, incluindo TypeScript, Vitest, arquitetura, documentação, build, agent check e regressão persistente em TiDB.
