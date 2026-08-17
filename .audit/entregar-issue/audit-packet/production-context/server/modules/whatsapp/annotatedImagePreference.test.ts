import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.fn();
const logInferenceEventMock = vi.fn();
const onDuplicateKeyUpdateMock = vi.fn(async () => undefined);
const valuesMock = vi.fn(() => ({ onDuplicateKeyUpdate: onDuplicateKeyUpdateMock }));
const insertMock = vi.fn(() => ({ values: valuesMock }));

vi.mock("../../db", () => ({
  getDb: getDbMock,
  logInferenceEvent: logInferenceEventMock,
}));

const {
  getAnnotatedImagePreference,
  parseAnnotatedImagePreference,
  setAnnotatedImagePreference,
} = await import("./annotatedImagePreference");

describe("annotated image preference", () => {
  beforeEach(() => {
    getDbMock.mockReset();
    logInferenceEventMock.mockReset();
    insertMock.mockClear();
    valuesMock.mockClear();
    onDuplicateKeyUpdateMock.mockClear();
  });

  it.each([
    [undefined, false],
    ["false", false],
    ["TRUE", false],
    ["1", false],
    ["invalid", false],
    ["true", true],
  ])("interpreta %s usando apenas o booleano canônico", (value, expected) => {
    expect(parseAnnotatedImagePreference(value)).toBe(expected);
  });

  it("usa fallback desabilitado e diagnóstico sanitizado quando a leitura falha", async () => {
    getDbMock.mockRejectedValue(new Error("secret database payload"));

    await expect(getAnnotatedImagePreference(42)).resolves.toEqual({ enabled: false, readFailed: true });
    expect(logInferenceEventMock).toHaveBeenCalledWith({
      userId: 42,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.annotated_image_preference_read_failed",
      detail: "Preferência de imagem auxiliar indisponível; fallback seguro desabilitado aplicado.",
    });
  });

  it.each([[true, "true"], [false, "false"]] as const)(
    "persiste %s na representação canônica por usuário",
    async (enabled, storedValue) => {
      getDbMock.mockResolvedValue({ insert: insertMock });

      await expect(setAnnotatedImagePreference(42, enabled)).resolves.toEqual({ enabled });
      expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({
        userId: 42,
        preferenceKey: "whatsapp_annotated_image_enabled",
        preferenceValue: storedValue,
      }));
      expect(onDuplicateKeyUpdateMock).toHaveBeenCalledWith({
        set: expect.objectContaining({ preferenceValue: storedValue }),
      });
    },
  );
});
