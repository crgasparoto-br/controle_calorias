export const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  ownerOpenId: "",
  isProduction: process.env.NODE_ENV === "production",
  aiProvider: process.env.AI_PROVIDER ?? "forge",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  openaiTranscriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1",
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
};