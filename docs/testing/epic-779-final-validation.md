# Validação final da epic #779

A entrega final deve ser validada no SHA atual da PR com os gates reais do repositório:

- `pnpm check`;
- `pnpm test`;
- `pnpm architecture:check`;
- `pnpm docs:check`;
- `pnpm build`;
- `pnpm agent:check`;
- regressão persistente do contexto WhatsApp em TiDB.

Os resultados válidos são os produzidos após a remoção dos workflows e artefatos temporários de aplicação de patches. A PR deve permanecer sem merge até que esses gates sejam concluídos no commit final.
