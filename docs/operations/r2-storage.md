# Configuracao do Cloudflare R2 para imagens do WhatsApp

Este projeto usa storage para salvar midias recebidas do WhatsApp e imagens auxiliares geradas para a resposta nutricional. Em producao, recomenda-se usar Cloudflare R2 com uma URL publica de leitura apenas para imagens que precisam ser baixadas pelo WhatsApp.

## 1. Criar o bucket no Cloudflare

1. Acesse o Cloudflare Dashboard.
2. Va em **Storage & databases > R2 Object Storage**.
3. Crie um bucket, por exemplo `controle-calorias-media`.
4. Guarde o nome do bucket para usar em `R2_BUCKET`.

## 2. Criar credenciais S3 do R2

1. Em **R2 > Overview**, abra **Manage API Tokens**.
2. Crie um token com permissao **Object Read & Write**.
3. Restrinja o token ao bucket do projeto quando possivel.
4. Copie o **Access Key ID** e o **Secret Access Key**. O secret so aparece uma vez.
5. Copie tambem o **Account ID** da conta Cloudflare.

## 3. Configurar acesso publico de leitura

O WhatsApp precisa conseguir baixar a imagem anotada ou a imagem auxiliar por uma URL publica. Para producao, prefira um dominio proprio conectado ao bucket, por exemplo:

```text
https://media.seudominio.com
```

No Cloudflare:

1. Abra o bucket R2.
2. Va em **Settings > Custom Domains**.
3. Conecte um subdominio gerenciado pela mesma conta Cloudflare.
4. Aguarde o status ficar ativo.

Use esse dominio em `R2_PUBLIC_BASE_URL`.

Para teste rapido, o `r2.dev` pode ser habilitado no bucket, mas a propria Cloudflare recomenda usar dominio customizado em producao.

## 4. Variaveis no Render

Configure estas variaveis no backend/API do Render:

```text
R2_ACCOUNT_ID=<account id da Cloudflare>
R2_BUCKET=controle-calorias-media
R2_ACCESS_KEY_ID=<access key id do token R2>
R2_SECRET_ACCESS_KEY=<secret access key do token R2>
R2_PUBLIC_BASE_URL=https://media.seudominio.com
```

Depois de salvar, faca redeploy do servico.

## 5. Privacidade das URLs

- O helper `storagePut(...)` so publica URL R2 quando o chamador pede `publicRead: true`.
- As imagens geradas para resposta no WhatsApp usam `publicRead: true`, pois a Meta precisa buscar a midia por URL publica quando o envio nao usa buffer.
- Fotos originais, imagens recebidas e outras midias salvas sem `publicRead` recebem uma URL interna `r2://...` no registro da aplicacao, nao a URL publica do bucket.
- As chaves R2 sao opacas (`public/media/<uuid>` ou `private/media/<uuid>`) e nao carregam telefone, `userId`, `imageId` ou nomes enviados pelos chamadores.
- Nao registre em logs a URL publica completa, telefone completo ou payload bruto de midia.
- Se o bucket estiver exposto por dominio publico, trate qualquer objeto cujo caminho vaze como potencialmente acessivel. Por isso, mantenha chaves opacas e use URLs publicas somente nos artefatos que precisam sair para o WhatsApp.

## 6. Retencao e exclusao

As linhas de `mealMedia` sao removidas junto com os dados principais da conta no fluxo de exclusao. Objetos externos ja enviados para o R2 dependem de rotina operacional de limpeza do bucket ou de lifecycle policy no Cloudflare. Configure uma politica de expiracao compativel com a retencao desejada para:

```text
public/media/
private/media/
```

Enquanto nao houver rotina automatica de delecao por chave, a exclusao da conta remove os vinculos do produto, mas nao garante a remocao imediata do objeto externo no R2.

## 7. Validacao manual

1. Envie uma nova foto pelo WhatsApp.
2. Confirme que a refeicao foi registrada.
3. Confirme que a imagem anotada ou imagem auxiliar foi enviada.
4. Nos logs, confirme se o evento `whatsapp.annotated_image_sent` informa `origem=ai_edit` ou `origem=fallback_local`.
5. Nos logs, procure por ausencia de erros como:

```text
Storage credentials missing
R2 storage credentials missing
Storage upload failed
whatsapp.annotated_image_skipped
```

6. No bucket R2, procure objetos em caminhos opacos como:

```text
public/media/
private/media/
```

7. Confirme que os objetos novos nao incluem telefone, `userId`, `imageId` ou nome original no caminho.

## Observacoes

- O projeto usa R2 quando qualquer variavel `R2_*` estiver configurada. Se alguma estiver faltando, o startup ou a primeira gravacao de storage falha com uma mensagem listando as variaveis ausentes.
- Se nenhuma variavel `R2_*` existir, o projeto continua tentando usar o storage Forge legado via `BUILT_IN_FORGE_API_URL` e `BUILT_IN_FORGE_API_KEY`.
- `R2_PUBLIC_BASE_URL` deve apontar para uma URL publica de leitura. O endpoint S3 `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` serve para upload autenticado e nao deve ser usado como URL publica para o WhatsApp.
