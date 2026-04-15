# Histórias de Usuário – Backlog Inicial

## Epic 1: Onboarding e Configuração

### US-001 – Primeiro Contato
**Como** novo usuário que nunca interagiu com o sistema,
**Quero** receber uma mensagem de boas-vindas ao enviar qualquer mensagem,
**Para que** eu saiba como usar o assistente e configurar meu perfil.

**Critérios de aceite:**
- Ao primeiro contato, usuário recebe mensagem de boas-vindas
- Mensagem explica como registrar refeições
- Sistema cria usuário com metas padrão (2000 kcal)

---

### US-002 – Configurar Meta de Calorias
**Como** usuário novo,
**Quero** definir minha meta diária de calorias,
**Para que** o sistema me informe quando estou dentro ou acima da meta.

**Critérios de aceite:**
- Usuário pode enviar "2000 kcal" ou "minha meta é 1800 calorias"
- Sistema extrai o número e atualiza a meta
- Sistema confirma: "✅ Meta de 2000 kcal configurada!"

---

### US-003 – Configurar Perfil Completo
**Como** usuário que deseja precisão,
**Quero** informar peso, altura, idade e nível de atividade,
**Para que** o sistema calcule automaticamente minha meta calórica.

**Critérios de aceite:**
- Sistema solicita dados sequencialmente
- Calcula TDEE via Harris-Benedict
- Sugere metas de macro (proteína, carbo, gordura)
- Permite aceitar ou ajustar

---

## Epic 2: Registro de Refeições

### US-004 – Registrar Refeição por Texto
**Como** usuário,
**Quero** descrever o que comi em texto livre,
**Para que** o sistema registre automaticamente os nutrientes.

**Critérios de aceite:**
- "almocei arroz, feijão, frango e salada" → extrai alimentos
- Mostra lista com calorias estimadas de cada item
- Mostra total da refeição e saldo do dia
- Tempo de resposta < 5 segundos

---

### US-005 – Registrar Refeição por Áudio
**Como** usuário que prefere falar,
**Quero** enviar um áudio descrevendo minha refeição,
**Para que** não precise digitar.

**Critérios de aceite:**
- Aceita OGG, MP4, WEBM
- Transcreve em português
- Processa igual ao texto
- Mostra transcrição na resposta

---

### US-006 – Registrar Refeição por Foto
**Como** usuário,
**Quero** tirar uma foto do meu prato,
**Para que** o sistema identifique os alimentos automaticamente.

**Critérios de aceite:**
- Identifica alimentos visíveis na foto
- Estima porções visualmente
- confidence_score < 0.7 → solicita confirmação
- Se rótulo: extrai valores do rótulo com precisão

---

### US-007 – Confirmar Refeição
**Como** usuário,
**Quero** confirmar ou corrigir o que o sistema identificou,
**Para que** os dados fiquem precisos.

**Critérios de aceite:**
- Botões de confirmar/cancelar via WhatsApp
- Opção de corrigir quantidade/alimento por texto
- Correções são salvas como padrão futuro

---

### US-008 – Registrar Água
**Como** usuário preocupado com hidratação,
**Quero** registrar o consumo de água,
**Para que** acompanhe minha meta de hidratação.

**Critérios de aceite:**
- "bebi 300ml de água" funciona
- "tomei um copo d'água" = 250ml padrão
- Meta diária padrão de 2L

---

## Epic 3: Consultas e Acompanhamento

### US-009 – Consultar Resumo Diário
**Como** usuário,
**Quero** ver um resumo do que comi hoje,
**Para que** saiba quanto ainda posso comer.

**Critérios de aceite:**
- Responde a "como estou hoje?", "resumo", "meu progresso"
- Mostra calorias: consumidas vs meta
- Mostra macros: proteína, carbo, gordura
- Barra de progresso visual em texto (emojis)

---

### US-010 – Histórico de Refeições
**Como** usuário,
**Quero** ver o que comi ontem ou na semana,
**Para que** acompanhe minha evolução.

**Critérios de aceite:**
- "o que eu comi ontem?" mostra resumo do dia anterior
- "resumo da semana" mostra totais dos últimos 7 dias
- Identifica padrões (ex: "você não tomou café em 3 dias")

---

### US-011 – Refeição Nomeada
**Como** usuário com rotina,
**Quero** dizer "meu café da manhã de sempre",
**Para que** não precise descrever toda vez.

**Critérios de aceite:**
- Após 3+ confirmações iguais, sistema salva o padrão
- "meu café de sempre" registra automaticamente
- Pede confirmação leve: "Café habitual? ☕ [Sim] [Não]"

---

## Epic 4: Aprendizado e Personalização

### US-012 – Sugestão de Alimentos
**Como** usuário com padrões,
**Quero** receber sugestões baseadas nos meus hábitos,
**Para que** o registro seja mais rápido.

**Critérios de aceite:**
- Sistema aprende alimentos frequentes por horário
- Sugere alimentos habituais ao registrar

---

### US-013 – Alerta de Meta
**Como** usuário com meta,
**Quero** ser alertado quando estou próximo de atingir minha meta,
**Para que** tome decisões conscientes sobre o próximo alimento.

**Critérios de aceite:**
- Alerta quando > 80% da meta atingida
- Alerta quando meta ultrapassada
- Tom motivador, não punitivo

---

## Epic 5: Dados e Privacidade (LGPD)

### US-014 – Exportar Dados
**Como** usuário,
**Quero** exportar todos os meus dados,
**Para que** tenha controle sobre minhas informações (LGPD Art. 18).

**Critérios de aceite:**
- "exportar meus dados" → recebe link para download (JSON/CSV)
- Inclui: refeições, metas, hábitos, mensagens

---

### US-015 – Deletar Conta
**Como** usuário,
**Quero** solicitar a exclusão da minha conta e dados,
**Para que** minhas informações sejam removidas (LGPD Art. 18).

**Critérios de aceite:**
- "deletar minha conta" inicia processo de confirmação
- Dados excluídos em até 30 dias
- Confirmação enviada ao usuário

---

## Epic 6: Admin e Analytics

### US-016 – Dashboard Administrativo
**Como** administrador,
**Quero** ver métricas de uso do produto,
**Para que** tome decisões baseadas em dados.

**Critérios de aceite:**
- Usuários ativos por dia/semana/mês
- Mensagens processadas por tipo (texto/áudio/imagem)
- Taxa de sucesso de extração
- Latência média de processamento

---

### US-017 – Gerenciar Banco de Alimentos
**Como** administrador,
**Quero** adicionar e editar itens no banco de alimentos,
**Para que** a base nutricional fique atualizada.

**Critérios de aceite:**
- CRUD de alimentos no admin panel
- Importação em massa via CSV
- Validação de valores nutricionais

---

## Priorização (MoSCoW)

| História | Must Have | Should Have | Could Have | Won't Have |
|----------|-----------|-------------|------------|------------|
| US-001   | ✅        |             |            |            |
| US-002   | ✅        |             |            |            |
| US-003   |           | ✅          |            |            |
| US-004   | ✅        |             |            |            |
| US-005   |           | ✅          |            |            |
| US-006   |           | ✅          |            |            |
| US-007   | ✅        |             |            |            |
| US-008   |           |             | ✅         |            |
| US-009   | ✅        |             |            |            |
| US-010   |           | ✅          |            |            |
| US-011   |           |             | ✅         |            |
| US-012   |           |             | ✅         |            |
| US-013   |           | ✅          |            |            |
| US-014   |           | ✅          |            |            |
| US-015   | ✅        |             |            |            |
| US-016   |           | ✅          |            |            |
| US-017   |           |             | ✅         |            |
