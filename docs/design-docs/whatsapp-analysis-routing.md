# WhatsApp analysis and report routing

Subissue: #418

## Goal

Messages asking for analysis, reports, charts, summaries, suggestions, goals, progress, quality, or history must be classified before any nutrition fallback can create a meal draft.

## Routing rules

- Food registration still continues to the existing food pipeline only when the message has a clear food registration signal.
- Daily summaries and history queries continue through the existing structured query path with `shouldAllowNutritionFallback: false`.
- Reports, charts, period summaries, suggestions, and goal/progress/quality questions return a safe router response while their final WhatsApp flows are not available.
- Mixed messages that ask to register food and generate analysis in the same text ask for clarification before saving anything.

## Safe fallback behavior

Unsupported analysis outputs do not call the LLM executor, text intents, assistant helper, or nutrition parser from the service entry point. They return a user-facing message that points to an available alternative, such as daily summary or reviewing records in the app.

## Default period

When a summary request does not include a period, the WhatsApp route treats it as a daily summary for today. Week and month summaries are kept as safe non-food responses until a period-aware executor is available.

## Validation coverage

The route tests cover valid food registration, charts, reports, daily and period summaries, meal/food suggestions, history queries, questions about goals, progress and food quality, and ambiguous mixed registration plus analysis messages. The service test also asserts that a suggestion request exits at the router without invoking food persistence.
