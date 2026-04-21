# Controle de Calorias

**Controle de Calorias** é uma plataforma de nutrição inteligente com foco em registro multimodal de refeições, acompanhamento de metas nutricionais, operação via web e integração com **WhatsApp Business Cloud API**. A solução atual foi consolidada em uma arquitetura única baseada em **React + Express + tRPC + Drizzle**, priorizando rapidez de evolução, rastreabilidade dos registros e experiência operacional simples para uso diário.

Após a revisão das demais branches do repositório, a principal conclusão foi que não havia funcionalidades mais novas prontas para incorporação direta na branch principal, mas havia **definições documentais úteis** que estavam dispersas ou em arquiteturas alternativas. Por isso, este README passa a consolidar no projeto atual os pontos que realmente fazem sentido manter: visão da solução, fluxos principais, modelo funcional, stack, operação e próximos cuidados técnicos.

## Visão geral da solução

A aplicação foi estruturada para atender dois canais principais de uso. No canal **web**, o usuário autentica-se, registra refeições por texto, imagem ou áudio, confirma a inferência nutricional e acompanha metas, hábitos e relatórios. No canal **WhatsApp**, a solução recebe mensagens, processa o conteúdo, gera a análise nutricional, registra a inferência e devolve uma resposta padronizada com a estrutura da refeição, os alimentos detectados e seus respectivos nutrientes.

| Domínio | Capacidade atual |
|---|---|
| Registro alimentar | Entrada por texto, imagem e áudio |
| Processamento nutricional | Inferência de alimentos, porções e totais de macros/calorias |
| Confirmação | Revisão e confirmação manual da refeição inferida |
| Persistência | Banco relacional com Drizzle e armazenamento de mídia em S3 |
| Relatórios | Resumo semanal, tendência de macros e detalhamento por refeição |
| Canal conversacional | Integração com WhatsApp Business Cloud API |
| Operação administrativa | Visão de uso, logs recentes e status do canal |

## Módulos entregues na interface web

A aplicação web está organizada em uma navegação de dashboard, voltada para uso operacional. Cada rota foi desenhada para cobrir uma etapa do fluxo nutricional e deixar explícita a passagem entre captura, confirmação e acompanhamento.

| Rota | Objetivo |
|---|---|
| `/` | Dashboard com resumo diário, metas e visão geral do uso |
| `/log-meal` | Registro multimodal de refeições com apoio de IA |
| `/goals` | Configuração de metas de calorias, proteínas, carboidratos e gorduras |
| `/reports` | Relatórios com semana iniciando na segunda-feira e detalhamento por refeição |
| `/channels` | Status do canal WhatsApp e recursos operacionais do webhook |
| `/admin` | Visão administrativa de uso, usuários e logs |

Na página de **Relatórios**, a semana foi ajustada para começar na **segunda-feira** e cada refeição confirmada exibe de forma visível os **alimentos registrados**, suas **porções**, **proteínas**, **carboidratos**, **gorduras**, **calorias** e o **horário do registro**.

## Fluxo funcional da refeição

O fluxo atual da solução segue uma lógica de inferência assistida. Primeiro, o usuário envia o conteúdo da refeição em um dos canais suportados. Em seguida, o sistema processa texto, imagem e/ou áudio, monta um rascunho de inferência e apresenta os itens identificados. Após a confirmação do usuário, a refeição é persistida no banco, os itens são registrados individualmente, os hábitos são atualizados e os relatórios passam a refletir o novo consumo.

> O mesmo núcleo de processamento nutricional é reutilizado entre a experiência web e a experiência via WhatsApp, o que reduz divergência entre canais e simplifica a manutenção das regras de negócio.

## Resposta padronizada no WhatsApp

A resposta automática do WhatsApp foi reformulada para seguir uma estrutura mais legível e próxima do modelo visual aprovado durante o projeto. A mensagem agora organiza o retorno por refeição, listando os alimentos identificados individualmente e exibindo o horário, proteínas, carboidratos, gorduras e calorias de cada item.

| Elemento da resposta | Situação atual |
|---|---|
| Cabeçalho da refeição | Implementado |
| Lista de alimentos | Implementado |
| Horário da refeição | Implementado com fuso de São Paulo |
| Proteínas, carboidratos, gorduras e calorias por item | Implementado |
| Imagem anotada de referência | Gerada como apoio visual |

## Arquitetura atual do projeto

A branch principal consolidou-se em uma arquitetura monolítica moderna, orientada a produto, sem a complexidade operacional das propostas alternativas encontradas em outras branches. Em vez de múltiplos serviços e infraestrutura separada, a solução atual mantém frontend, backend, autenticação, banco e integrações dentro de um mesmo projeto, com contratos tipados ponta a ponta.

| Camada | Tecnologia atual | Papel na solução |
|---|---|---|
| Frontend | React 19 + Vite + Tailwind 4 | Interface web e dashboard operacional |
| Backend | Express 4 + tRPC 11 | Procedimentos tipados e lógica de negócio |
| Banco | MySQL/TiDB + Drizzle ORM | Persistência de metas, refeições, itens, hábitos e inferências |
| Armazenamento | S3 helper do projeto | Mídias de imagem e áudio |
| IA | LLM + transcrição + geração de imagem via helpers do projeto | Inferência nutricional e suporte multimodal |
| Canal externo | WhatsApp Business Cloud API | Entrada e resposta conversacional |
| Testes | Vitest | Cobertura de backend e frontend |

## Estrutura de pastas relevante

A estrutura do projeto foi mantida simples e consistente com a stack atual. Os diretórios abaixo concentram praticamente toda a lógica funcional e são os mais importantes para manutenção.

| Caminho | Conteúdo |
|---|---|
| `client/src/pages/` | Páginas do dashboard e fluxos do usuário |
| `client/src/components/` | Componentes reutilizáveis da interface |
| `server/` | Regras de negócio, router nutricional, webhook do WhatsApp e camada de persistência |
| `drizzle/` | Schema e migrações do banco |
| `scripts/` | Scripts auxiliares de migração, catálogo e verificação |
| `shared/` | Tipos e constantes compartilhadas |

## Principais operações disponíveis no backend

O backend atual expõe os casos de uso centrais do produto por meio do router nutricional, com autenticação para o ambiente web e procedimentos públicos apenas onde realmente faz sentido operacional.

| Grupo | Operações principais |
|---|---|
| `dashboard` | Visão consolidada do consumo e hábitos |
| `goals` | Leitura e atualização das metas nutricionais |
| `meals` | Listagem, processamento de rascunho e confirmação de refeição |
| `reports` | Resumo semanal |
| `admin` | Visão operacional e administrativa |
| `whatsapp` | Status do webhook e simulação inbound |

## Branches revisadas do repositório

Foram revisadas as branches remotas existentes no GitHub para verificar se havia alguma definição importante não incorporada à solução atual.

| Branch | Situação encontrada | Conclusão |
|---|---|---|
| `main` | Branch principal consolidada e mais atual | Continua sendo a base correta do projeto |
| `copilot/create-saas-calorie-tracker` | Branch divergente, com arquitetura alternativa orientada a múltiplos serviços e documentação extensa | Útil como referência documental, mas não como base de código para merge direto |
| `copilot/create-saas-solution-calorie-control` | Branch atrás da main | Sem conteúdo adicional relevante |
| `copilot/execute-web-application` | Branch atrás da main | Sem conteúdo adicional relevante |

A branch `copilot/create-saas-calorie-tracker` continha materiais úteis sobre **arquitetura**, **modelo de dados**, **fluxos**, **stack** e **contratos de API**, mas dentro de uma solução diferente da que foi efetivamente implementada. Em vez de tentar misturar arquiteturas, este README incorpora apenas as definições conceituais que ajudam a entender o produto atual.

## Setup local

A execução local do projeto parte de uma instalação Node moderna com `pnpm`. Como a aplicação depende de variáveis de ambiente gerenciadas pela plataforma para autenticação, banco, storage e integrações, o uso mais confiável continua sendo dentro do ambiente gerenciado do projeto. Ainda assim, a base local pode ser preparada para desenvolvimento e testes.

| Etapa | Comando |
|---|---|
| Instalar dependências | `pnpm install` |
| Rodar em desenvolvimento | `pnpm dev` |
| Executar testes | `pnpm test` |
| Validar TypeScript | `pnpm check` |
| Gerar/aplicar migrações com Drizzle | `pnpm db:push` |
| Gerar build | `pnpm build` |

## Variáveis e integrações importantes

O projeto depende de variáveis injetadas pelo ambiente para autenticação Manus OAuth, banco de dados, storage e canal WhatsApp. Em desenvolvimento controlado pela plataforma, essas variáveis já são disponibilizadas conforme a configuração do projeto.

| Grupo | Exemplos |
|---|---|
| Banco e sessão | `DATABASE_URL`, `JWT_SECRET` |
| OAuth e identidade | `VITE_APP_ID`, `OAUTH_SERVER_URL`, `VITE_OAUTH_PORTAL_URL` |
| Forge / APIs internas | `BUILT_IN_FORGE_API_KEY`, `BUILT_IN_FORGE_API_URL` |
| WhatsApp | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` |

## Qualidade e testes

A base foi evoluída com cobertura automatizada para os fluxos críticos já implementados. Atualmente, os testes cobrem regras do motor nutricional, logout/autenticação, webhook do WhatsApp, router nutricional e renderização das páginas centrais do frontend. Isso inclui os ajustes recentes na resposta do WhatsApp e na visualização dos relatórios.

## Limitações e cuidados atuais

A solução está funcional para o escopo atual, mas há alguns pontos que merecem atenção contínua. O primeiro é manter o schema do banco sempre alinhado às migrações, especialmente em estruturas como `mealInferences`. O segundo é seguir exportando versões estáveis para o GitHub e checkpoints do ambiente para evitar divergência entre código remoto e estado operacional. O terceiro é tratar o README como fonte viva do produto, revisando-o sempre que houver mudanças estruturais em canais, fluxos ou modelo de dados.

## Próximos passos recomendados

Como evolução natural da plataforma, os próximos incrementos mais úteis tendem a ser a exportação formal de relatórios, filtros temporais mais flexíveis e maior personalização da resposta conversacional. Em paralelo, também faria sentido ampliar a documentação com diagramas específicos apenas quando isso trouxer valor real para manutenção ou onboarding.
