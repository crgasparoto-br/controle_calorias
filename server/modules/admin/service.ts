import {
  getAdminActivities,
  getAdminSnapshot,
  getAdminWhatsAppTokenStatus,
  logInferenceEvent,
  upsertAdminWhatsAppAccessToken,
} from "../../db";
import {
  previewFoodImportJob as previewFoodImportJobService,
  publishFoodImportJob as publishFoodImportJobService,
  runFoodImportJob as runFoodImportJobService,
} from "./foodImportJobs";
import type {
  PreviewFoodImportJobInput,
  PublishFoodImportJobInput,
  RunFoodImportJobInput,
  UpdateWhatsappTokenInput,
} from "./schemas";
import { buildQuestionLatencyPercentiles } from "../whatsapp/questionLatencyMetrics";

export async function getAdminOverview() {
  const snapshot = await getAdminSnapshot();
  return {
    ...snapshot,
    questionLatency: buildQuestionLatencyPercentiles(
      snapshot.recentInferenceLogs
    ),
  };
}

export function getAdminActivityPage(
  input: Parameters<typeof getAdminActivities>[0]
) {
  return getAdminActivities(input);
}

export async function getWhatsappTokenStatus() {
  return getAdminWhatsAppTokenStatus();
}

export async function updateWhatsappToken(
  userId: number,
  input: UpdateWhatsappTokenInput
) {
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

export async function runFoodImportJob(
  userId: number,
  input: RunFoodImportJobInput
) {
  const report = await runFoodImportJobService(input, {
    initiatedBy: `admin:user:${userId}`,
  });

  logInferenceEvent({
    userId,
    origin: "admin",
    status: report.errors.length ? "warning" : "success",
    eventType: "foods.import_job_executed",
    detail: `Importação da base alimentar concluída: ${report.inserted} inseridos, ${report.updated} atualizados, ${report.ignored} ignorados e ${report.errors.length} erros.`,
  });

  return report;
}

export async function previewFoodImportJob(
  userId: number,
  input: PreviewFoodImportJobInput
) {
  const report = await previewFoodImportJobService(input, {
    initiatedBy: `admin:user:${userId}`,
  });
  logInferenceEvent({
    userId,
    origin: "admin",
    status: report.errors.length ? "warning" : "success",
    eventType: "foods.import_preview_created",
    detail: `Prévia ${report.sourceSlug}@${report.sourceVersion}: ${report.validRows}/${report.totalRows} linhas válidas; ${report.errors.length} alertas; sem mutação do catálogo.`,
  });
  return report;
}

export async function publishFoodImportJob(
  userId: number,
  input: PublishFoodImportJobInput
) {
  const report = await publishFoodImportJobService(input, {
    initiatedBy: `admin:user:${userId}`,
    expectedPreviewHash: input.previewHash,
  });
  logInferenceEvent({
    userId,
    origin: "admin",
    status: report.errors.length ? "warning" : "success",
    eventType: "foods.import_job_executed",
    detail: `Importação da base alimentar concluída: ${report.inserted} inseridos, ${report.updated} atualizados, ${report.ignored} ignorados e ${report.errors.length} erros.`,
  });
  return report;
}
