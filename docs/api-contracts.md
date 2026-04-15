# Contratos de API

## Autenticação

Todas as rotas autenticadas requerem header:
```
Authorization: Bearer <JWT_TOKEN>
```

---

## WhatsApp Webhook

### GET /webhook/whatsapp
Verificação do webhook pelo Meta.

**Query params:**
- `hub.mode` = `subscribe`
- `hub.verify_token` = valor configurado em `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `hub.challenge` = string de desafio

**Response 200:** retorna o challenge como texto puro.

---

### POST /webhook/whatsapp
Recebe mensagens do WhatsApp.

**Headers:** `x-hub-signature-256` para verificação de assinatura (HMAC-SHA256)

**Request Body:**
```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "BUSINESS_ACCOUNT_ID",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": {
          "display_phone_number": "5511999999999",
          "phone_number_id": "PHONE_NUMBER_ID"
        },
        "contacts": [{ "profile": { "name": "João Silva" }, "wa_id": "5511999999999" }],
        "messages": [{
          "id": "wamid.xxx",
          "from": "5511999999999",
          "timestamp": "1722000000",
          "type": "text",
          "text": { "body": "almocei arroz, feijão e frango grelhado" }
        }]
      },
      "field": "messages"
    }]
  }]
}
```

**Response 200:**
```json
{ "status": "ok" }
```

---

## Users API

### GET /api/v1/users/me
Retorna o perfil e metas do usuário autenticado.

**Response 200:**
```json
{
  "user": {
    "id": "uuid",
    "phone": "+5511999999999",
    "name": "João Silva",
    "email": "joao@example.com",
    "timezone": "America/Sao_Paulo",
    "onboardingCompleted": true,
    "createdAt": "2024-01-15T10:00:00Z"
  },
  "goal": {
    "caloriesPerDay": 2000,
    "proteinPerDay": 150,
    "carbsPerDay": 225,
    "fatPerDay": 65,
    "fiberPerDay": 25,
    "waterPerDay": 2000,
    "goalType": "MAINTAIN",
    "activityLevel": "MODERATELY_ACTIVE"
  }
}
```

---

### PUT /api/v1/users/me/goal
Atualiza as metas nutricionais do usuário.

**Request Body:**
```json
{
  "caloriesPerDay": 2200,
  "proteinPerDay": 160,
  "carbsPerDay": 250,
  "fatPerDay": 70,
  "currentWeightKg": 80,
  "heightCm": 175,
  "age": 30,
  "gender": "MALE",
  "activityLevel": "MODERATELY_ACTIVE",
  "goalType": "BUILD_MUSCLE"
}
```

**Response 200:**
```json
{
  "goal": { "...campos atualizados..." }
}
```

---

### GET /api/v1/users/me/summary
Retorna o resumo nutricional diário.

**Query params:**
- `date` (opcional) – formato `YYYY-MM-DD`, padrão: hoje

**Response 200:**
```json
{
  "date": "2024-07-15",
  "summary": {
    "totalCalories": 1450,
    "totalProtein": 95,
    "totalCarbs": 165,
    "totalFat": 42,
    "totalFiber": 18,
    "mealsCount": 3
  },
  "goal": {
    "caloriesPerDay": 2000,
    "proteinPerDay": 150,
    "carbsPerDay": 225,
    "fatPerDay": 65
  },
  "progress": {
    "calories": 73,
    "protein": 63,
    "carbs": 73,
    "fat": 65
  },
  "frequentFoods": [
    { "name": "Arroz branco", "frequency": 15 },
    { "name": "Frango grelhado", "frequency": 12 }
  ]
}
```

---

## Meals API

### GET /api/v1/meals
Lista as refeições do usuário.

**Query params:**
- `date` – filtrar por data específica `YYYY-MM-DD`
- `startDate` / `endDate` – intervalo de datas
- `mealType` – `BREAKFAST|LUNCH|DINNER|...`
- `page` (padrão: 1)
- `limit` (padrão: 10, máx: 50)

**Response 200:**
```json
{
  "data": [{
    "id": "uuid",
    "date": "2024-07-15T00:00:00Z",
    "mealType": "LUNCH",
    "totalCalories": 650,
    "totalProtein": 45,
    "totalCarbs": 80,
    "totalFat": 18,
    "confirmedByUser": true,
    "sourceType": "TEXT",
    "items": [{
      "id": "uuid",
      "foodName": "Arroz branco cozido",
      "quantity": 150,
      "unit": "g",
      "calories": 192,
      "protein": 3.8,
      "carbs": 42.2,
      "fat": 0.3,
      "confidenceScore": 0.95,
      "source": "NUTRITIONAL_DB"
    }]
  }],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 45,
    "pages": 5
  }
}
```

---

### GET /api/v1/meals/:id
Retorna uma refeição específica.

**Response 200:** mesmo formato de um item de `data` acima.
**Response 404:** `{ "error": "Meal not found" }`

---

### DELETE /api/v1/meals/:id
Remove uma refeição.

**Response 204:** sem body.

---

### PATCH /api/v1/meals/:mealId/items/:itemId
Corrige um item de uma refeição (confirmação do usuário).

**Request Body:**
```json
{
  "quantity": 200,
  "unit": "g",
  "calories": 256
}
```

**Response 200:**
```json
{
  "id": "uuid",
  "foodName": "Arroz branco cozido",
  "quantity": 200,
  "unit": "g",
  "calories": 256,
  "source": "USER_CONFIRMED",
  "confidenceScore": 1.0
}
```

---

## Health Check

### GET /health
Status básico do serviço.

**Response 200:**
```json
{ "status": "ok", "timestamp": "2024-07-15T10:00:00Z" }
```

---

### GET /health/ready
Verifica conectividade com banco e Redis.

**Response 200:**
```json
{
  "status": "ready",
  "checks": { "database": "ok", "redis": "ok" },
  "timestamp": "2024-07-15T10:00:00Z"
}
```

**Response 503:** quando alguma dependência estiver indisponível.

---

## Métricas

### GET /metrics
Métricas no formato Prometheus.

**Response 200:** texto Prometheus exposition format.

---

## Códigos de Erro

| HTTP Status | Código                | Descrição                               |
|-------------|----------------------|-----------------------------------------|
| 400         | ValidationError      | Dados de entrada inválidos              |
| 401         | Unauthorized         | Token JWT ausente ou inválido           |
| 403         | Forbidden            | Sem permissão para o recurso            |
| 404         | NotFound             | Recurso não encontrado                  |
| 429         | TooManyRequests      | Rate limit excedido                     |
| 500         | InternalServerError  | Erro interno inesperado                 |
| 503         | ServiceUnavailable   | Dependência indisponível                |
