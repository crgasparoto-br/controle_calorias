import {
  getAdminSnapshot,
  getAdminWhatsAppTokenStatus,
  logInferenceEvent,
  upsertAdminWhatsAppAccessToken,
} from "../../db";
import { runFoodImportJob as runFoodImportJobService } from "./foodImportJobs";
import type { RunFoodImportJobInput, UpdateWhatsappTokenInput } from "./schemas";

export async function getAdminOverview() {
  return getAdminSnapshot();
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
    detail: `Token de acesso do WhatsApp atualizado via painel administrativo com origem ${status.source}.`,
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
    detail: `Job ${input.job} executado via painel administrativo: ${report.inserted} inseridos, ${report.updated} atualizados, ${report.ignored} ignorados, ${report.errors.length} erros.`,
  });

  return report;
}
