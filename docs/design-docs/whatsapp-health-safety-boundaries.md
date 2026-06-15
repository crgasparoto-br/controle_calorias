# WhatsApp health and diet safety boundaries

Subissue: #426

## Goal

Health, diet, symptom, medication, supplementation, and professional-orientation questions must not become food records and must not produce diagnosis, prescription, or individualized clinical conduct through WhatsApp.

## Intent classes

- `possivel_urgencia_saude`: symptoms or risk signals such as feeling unwell, shortness of breath, chest pain, fainting, severe pressure concerns, hypoglycemia, bleeding, seizure, emergency, or urgent help.
- `pergunta_medica_sensivel`: chronic conditions, medication, pregnancy, allergies, eating disorders, diabetes, hypertension, renal/liver issues, mental health, or other sensitive clinical context.
- `pergunta_saude_dieta`: diet or supplementation decisions that could become individualized conduct, such as fasting, low carb, ketogenic diet, supplements, calorie cuts, or requests for prescriptions/plans.
- `pergunta_sobre_alimento`: simple food questions without clinical context, such as asking whether a food is caloric.

## Safe replies

- Urgency replies instruct the user to seek emergency care or a health professional immediately and explicitly avoid registering food or providing clinical conduct.
- Sensitive medical replies state that the topic depends on the user's history and professional evaluation, and that WhatsApp will not diagnose, prescribe, or guide clinical conduct.
- Diet/supplement replies limit the assistant to record support and avoid prescribing fasting, supplements, calorie cuts, or individual plans.
- Simple food questions can receive non-persistent food-question handling and remain outside the meal registration flow.

## Pipeline behavior

The safety route runs after numeric/context guards and before analysis, LLM, text intents, assistant helpers, and nutrition fallback. A matched safety route returns `safe_non_food_response` with `shouldAllowNutritionFallback: false`.

The existing service logging records the router event, canonical intent, confidence, route action, and reason. No meal persistence tool is called for these safety responses.

## Professional integration

This delivery defines the boundary and safe fallback. Routing to a linked professional or permissioned professional-patient workflow remains dependent on the dedicated professional flow subissues.

## Test coverage

Tests cover diabetes, fasting, supplementation, severe symptoms or pressure risk, calorie-cut prescription requests, and a simple food question to verify it is not overclassified as sensitive health advice.
