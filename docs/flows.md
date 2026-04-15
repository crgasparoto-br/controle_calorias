# Fluxos Principais

## Fluxo 1: Registro de Refeição por Texto

```
┌─────────┐         ┌──────────┐         ┌──────────┐         ┌──────────┐
│ Usuário │         │ WhatsApp │         │   API    │         │  OpenAI  │
└────┬────┘         └────┬─────┘         └────┬─────┘         └────┬─────┘
     │                   │                    │                    │
     │ "almocei arroz,   │                    │                    │
     │  feijão e frango" │                    │                    │
     │──────────────────►│                    │                    │
     │                   │   POST /webhook    │                    │
     │                   │───────────────────►│                    │
     │                   │   200 OK           │                    │
     │                   │◄───────────────────│                    │
     │                   │                    │                    │
     │                   │                    │ MessageLog PENDING │
     │                   │                    │ Enfileira job      │
     │                   │                    │                    │
     │                   │                    │ GPT-4o extraction  │
     │                   │                    │───────────────────►│
     │                   │                    │ foods + quantities │
     │                   │                    │◄───────────────────│
     │                   │                    │                    │
     │                   │                    │ Match DB (TACO)    │
     │                   │                    │ Meal criada        │
     │                   │                    │ Daily Summary ↑    │
     │                   │                    │                    │
     │                   │                    │ GPT-4o feedback    │
     │                   │                    │───────────────────►│
     │                   │                    │ resposta amigável  │
     │                   │                    │◄───────────────────│
     │                   │                    │                    │
     │ "✅ Refeição       │  Envia resposta    │                    │
     │  registrada!..."  │◄───────────────────│                    │
     │◄──────────────────│                    │                    │
```

## Fluxo 2: Registro por Áudio

```
Usuário envia áudio de 10s descrevendo a refeição
    │
    ▼
Webhook recebe mensagem tipo "audio"
    │
    ▼
MessageLog criado (PENDING) - media_url = ID da mídia no WhatsApp
    │
    ▼
BullMQ job enfileirado (process-message, mediaType=audio)
    │
    ▼
Worker: baixa o arquivo de áudio do WhatsApp API (OGG)
    │
    ▼
Whisper (OpenAI) transcreve para texto PT-BR
    │
    ▼
Mesmo pipeline de extração textual (GPT-4o)
    │
    ▼
MessageLog atualizado com transcription + resultado
    │
    ▼
Resposta enviada ao usuário com a refeição registrada
```

## Fluxo 3: Registro por Imagem/Foto

```
Usuário envia foto do prato (ou rótulo do alimento)
    │
    ▼
Webhook recebe mensagem tipo "image"
    │
    ▼
Worker: baixa a imagem do WhatsApp API (JPEG)
    │
    ▼
Converte para base64
    │
    ▼
GPT-4o Vision analisa:
  - Identifica alimentos visíveis
  - Estima porções por tamanho visual
  - Se rótulo: extrai valores nutricionais exatos
    │
    ▼
confidence_score < 0.7? → Solicita confirmação via botões
confidence_score >= 0.7? → Registra e envia feedback
```

## Fluxo 4: Confirmação pelo Usuário

```
Sistema envia mensagem com botões:
"[✅ Confirmar]  [❌ Corrigir]"
    │
    ▼
Usuário toca "✅ Confirmar"
    │
    ▼
Webhook recebe tipo "interactive" / button_reply
    │
    ▼
button_reply.id = "confirm_meal:<mealId>"
    │
    ▼
Meal.confirmedByUser = true
    │
    ▼
Embedding salvo para aprendizado futuro
    │
    ▼
Resposta: "✅ Refeição confirmada! Continue assim! 💪"
```

## Fluxo 5: Refeição Nomeada ("meu café da manhã de sempre")

```
Usuário: "café da manhã de sempre"
    │
    ▼
TextProcessor detecta padrão nomeado
    │
    ▼
habitsService.checkNamedMealPattern()
    │
    ▼
embeddingService.findNamedMeal() - busca por similaridade coseno
    │
    ├─► Similaridade > 0.9? → Usa extraction salva anteriormente
    │                          Registra refeição diretamente
    │                          Pede confirmação leve
    │
    └─► Não encontrado? → Processa normalmente com GPT-4o
                          Após confirmação, salva como NAMED_MEAL
```

## Fluxo 6: Onboarding (Novo Usuário)

```
Usuário envia primeira mensagem
    │
    ▼
findOrCreateByPhone() - cria usuário com metas padrão
    │
    ▼
user.onboardingCompleted = false
    │
    ▼
Sistema envia mensagem de boas-vindas:
  "👋 Olá! Bem-vindo ao Controle Calorias! 🥗
   Para começar, me diga sua meta diária de calorias
   ou envie 'configurar perfil'..."
    │
    ▼
Usuário responde com meta (ex: "2200 kcal")
    │
    ▼
Sistema atualiza UserGoal
    │
    ▼
user.onboardingCompleted = true
    │
    ▼
Sistema confirma e orienta sobre como registrar refeições
```

## Fluxo 7: Resumo Diário

```
Usuário: "como estou hoje?" ou "resumo"
    │
    ▼
TextProcessor identifica intenção de consulta
(não é alimento → redireciona para resumo)
    │
    ▼
nutritionService.getDailySummary(userId, hoje)
    │
    ▼
Formata resposta com barras de progresso:
  "📊 Resumo de hoje (15/07):
   🔥 Calorias: [████████░░] 78% (1.560/2.000 kcal)
   💪 Proteínas: 95g / 150g
   🍞 Carbs: 165g / 225g
   🥑 Gorduras: 42g / 65g
   
   Você ainda tem 440 kcal disponíveis.
   💡 Dica: inclua uma fonte de proteína no jantar!"
```
