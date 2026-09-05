import {
  getAdminSnapshot,
  getAdminWhatsAppTokenStatus,
  logInferenceEvent,
  upsertAdminWhatsAppAccessToken,
} from "../../db";
import { runFoodImportJob as runFoodImportJobService } from "./foodImportJobs";
import type { RunFoodImportJobInput, UpdateWhatsappTokenInput } from "./schemas";
import { buildQuestionLatencyPercentiles } from "../whatsapp/questionLatencyMetrics";

export async function getAdminOverview() {
  const snapshot = await getAdminSnapshot();
  return {
    ...snapshot,
    questionLatency: buildQuestionLatencyPercentiles(snapshot.recentInferenceLogs),
  };
}

export async function getWhatsappTokenStatus() {
  return getAdminWhatsAppTokenStatus();
}

export async function updateWhatsappToken(userId: number, input: UpdateWhatsappTokenInput) {
  const status = await upsertAdminWhatsAppAccessToken({
    value: input.accessToken,
    updatedByUserId: userId,
  });

  logInferenceEvent({
    userId,
    origin: "admin",
    status: "success",
    eventType: "whatsapp.access_token_updated",
    detail: "Credencial do WhatsApp atualizada pelo painel administrativo.",
  });

  return status;
}

export async function runFoodImportJob(userId: number, input: RunFoodImportJobInput) {
  const report = await runFoodImportJobService(input);

  logInferenceEvent({
    userId,
    origin: "admin",
    status: report.errors.length ? "warning" : "success",
    eventType: "foods.import_job_executed",
    detail: `Importação da base alimentar concluída: ${report.inserted} inseridos, ${report.updated} atualizados, ${report.ignored} ignorados e ${report.errors.length} erros.`,
  });

  return report;
}
