import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../whatsapp/webhookUtils", () => ({
  sendWhatsAppTextMessage: vi.fn(async () => ({ ok: true, detail: "sent" })),
}));

import { upsertUserWhatsappConnection } from "../../db";
import { sendWhatsAppTextMessage } from "../whatsapp/webhookUtils";
import {
  buildProfessionalAccessAuthorizationMessage,
  buildProfessionalAccessDecisionCode,
  parseProfessionalAccessWhatsappDecision,
  processProfessionalAccessWhatsappResponse,
  requestPatientAccess,
  listProfessionalAccesses,
  upsertProfessionalProfile,
} from "./service";

const mockedSendWhatsAppTextMessage = vi.mocked(sendWhatsAppTextMessage);

describe("professional WhatsApp authorization", () => {
  beforeEach(() => {
    mockedSendWhatsAppTextMessage.mockClear();
    mockedSendWhatsAppTextMessage.mockResolvedValue({ ok: true, detail: "sent" });
  });

  it("monta mensagem com opções claras de autorização e negativa", () => {
    const accessId = "abc12345-def6";
    const code = buildProfessionalAccessDecisionCode(accessId);
    const message = buildProfessionalAccessAuthorizationMessage({
      professionalDisplayName: "Dra. Ana Nutri",
      reason: "Acompanhamento semanal",
      accessId,
    });

    expect(code).toBe("ABC12345");
    expect(message).toContain("Dra. Ana Nutri solicitou autorização");
    expect(message).toContain("Motivo: Acompanhamento semanal");
    expect(message).toContain(`AUTORIZAR ${code}`);
    expect(message).toContain(`NEGAR ${code}`);
  });

  it("interpreta decisões positivas e negativas do paciente", () => {
    expect(parseProfessionalAccessWhatsappDecision("autorizo o acompanhamento")).toBe("approved");
    expect(parseProfessionalAccessWhatsappDecision("sim, pode aprovar")).toBe("approved");
    expect(parseProfessionalAccessWhatsappDecision("não autorizo")).toBe("rejected");
    expect(parseProfessionalAccessWhatsappDecision("negar acesso")).toBe("rejected");
    expect(parseProfessionalAccessWhatsappDecision("almoço: arroz e feijão")).toBeNull();
  });

  it("envia autorização ao WhatsApp do paciente e aprova a resposta recebida", async () => {
    const professionalUserId = 401;
    const patientUserId = 402;
    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Dra. Ana Nutri",
      registrationNumber: "CRN 123",
      active: true,
    });
    await upsertUserWhatsappConnection({
      userId: patientUserId,
      phoneNumber: "5511999999402",
      displayName: "Paciente 402",
    });

    const access = await requestPatientAccess(professionalUserId, {
      patientContact: `user-${patientUserId}@example.com`,
      reason: "Acompanhamento semanal",
    });
    const code = buildProfessionalAccessDecisionCode(access.id);

    expect(access.status).toBe("pending");
    expect(access.authorizationMessage?.status).toBe("sent");
    expect(mockedSendWhatsAppTextMessage).toHaveBeenCalledWith(
      "5511999999402",
      expect.stringContaining(`AUTORIZAR ${code}`),
    );

    const response = await processProfessionalAccessWhatsappResponse(patientUserId, `AUTORIZAR ${code}`);

    expect(response?.action).toBe("professional_access_approved");
    expect(response?.data).toMatchObject({
      id: access.id,
      status: "approved",
      responseOrigin: "whatsapp",
      responseDecision: "approved",
    });
    expect(typeof response?.data.respondedAt).toBe("number");

    const professionalAccesses = await listProfessionalAccesses(professionalUserId);
    expect(professionalAccesses.find(item => item.id === access.id)).toMatchObject({
      status: "approved",
      responseOrigin: "whatsapp",
      responseDecision: "approved",
    });
  });

  it("recusa a solicitação pelo WhatsApp quando paciente responde negativamente", async () => {
    const professionalUserId = 403;
    const patientUserId = 404;
    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Nutri Carlos",
      active: true,
    });
    await upsertUserWhatsappConnection({
      userId: patientUserId,
      phoneNumber: "5511999999404",
      displayName: "Paciente 404",
    });

    const access = await requestPatientAccess(professionalUserId, {
      patientContact: `user-${patientUserId}@example.com`,
      reason: "Revisão de evolução",
    });
    const response = await processProfessionalAccessWhatsappResponse(patientUserId, "negar");

    expect(response?.action).toBe("professional_access_rejected");
    expect(response?.data).toMatchObject({
      id: access.id,
      status: "rejected",
      responseOrigin: "whatsapp",
      responseDecision: "rejected",
    });
  });

  it("registra falha de envio para exibição ao profissional", async () => {
    const professionalUserId = 405;
    const patientUserId = 406;
    mockedSendWhatsAppTextMessage.mockResolvedValueOnce({ ok: false, detail: "Meta retornou 500 Internal Server Error" });
    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Dra. Beatriz",
      active: true,
    });
    await upsertUserWhatsappConnection({
      userId: patientUserId,
      phoneNumber: "5511999999406",
      displayName: "Paciente 406",
    });

    const access = await requestPatientAccess(professionalUserId, {
      patientContact: `user-${patientUserId}@example.com`,
      reason: "Plano alimentar",
    });

    expect(access.authorizationMessage).toMatchObject({
      status: "failed",
      detail: "Meta retornou 500 Internal Server Error",
    });

    const professionalAccesses = await listProfessionalAccesses(professionalUserId);
    expect(professionalAccesses.find(item => item.id === access.id)).toMatchObject({
      authorizationMessageStatus: "failed",
      authorizationMessageError: "Meta retornou 500 Internal Server Error",
    });
  });
});
