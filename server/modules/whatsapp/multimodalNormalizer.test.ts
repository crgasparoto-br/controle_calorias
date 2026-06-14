import { describe, expect, it, vi } from "vitest";
import { normalizeWhatsappMultimodalInput } from "./multimodalNormalizer";

describe("normalizeWhatsappMultimodalInput", () => {
  it("normaliza texto antes do roteador", async () => {
    const normalized = await normalizeWhatsappMultimodalInput({ text: "  Comi 100 gramas de arroz  " });

    expect(normalized).toEqual(expect.objectContaining({
      inputModality: "texto",
      originalText: "Comi 100 gramas de arroz",
      transcribedText: null,
      needsClarification: false,
    }));
    expect(normalized.routerText).toContain("100 g");
    expect(normalized.extraction.performed).toBe("none");
  });

  it("transcreve audio por provider antes do roteamento", async () => {
    const transcribeAudio = vi.fn().mockResolvedValue({ text: "Almocei arroz, feijão e frango", confidence: 0.82 });

    const normalized = await normalizeWhatsappMultimodalInput({
      media: { type: "audio", mediaId: "audio-1", mimeType: "audio/ogg" },
    }, { transcribeAudio });

    expect(transcribeAudio).toHaveBeenCalledWith(expect.objectContaining({ mediaId: "audio-1" }));
    expect(normalized).toEqual(expect.objectContaining({
      inputModality: "audio",
      transcribedText: "Almocei arroz, feijão e frango",
      routerText: "Almocei arroz, feijão e frango",
      needsClarification: false,
    }));
    expect(normalized.extraction).toEqual(expect.objectContaining({
      performed: "audio_transcription",
      confidence: 0.82,
      source: "provider",
    }));
  });

  it("usa legenda como contexto de imagem de alimento", async () => {
    const normalized = await normalizeWhatsappMultimodalInput({
      media: {
        type: "image",
        mediaId: "image-1",
        mimeType: "image/jpeg",
        caption: "Meu almoço com arroz, feijão e frango",
      },
    });

    expect(normalized).toEqual(expect.objectContaining({
      inputModality: "imagem_com_legenda",
      needsClarification: false,
    }));
    expect(normalized.mediaContext).toEqual(expect.objectContaining({
      mediaId: "image-1",
      mediaKind: "alimento",
      caption: "Meu almoço com arroz, feijão e frango",
    }));
    expect(normalized.routerText).toContain("Imagem de alimento enviada");
    expect(normalized.routerText).toContain("arroz");
  });

  it("diferencia imagem de rotulo nutricional", async () => {
    const normalized = await normalizeWhatsappMultimodalInput({
      media: {
        type: "image",
        mediaId: "label-1",
        imageDescription: "Foto de rótulo nutricional com calorias, carboidratos e proteínas por porção",
      },
    });

    expect(normalized.inputModality).toBe("imagem");
    expect(normalized.mediaContext).toEqual(expect.objectContaining({
      mediaKind: "rotulo_nutricional",
      extractionConfidence: expect.any(Number),
    }));
    expect(normalized.extraction).toEqual(expect.objectContaining({
      performed: "image_classification",
      source: "provided_image_description",
    }));
    expect(normalized.routerText).toContain("Rótulo nutricional enviado por imagem");
  });

  it("pede esclarecimento para imagem sem legenda ou descricao suficiente", async () => {
    const normalized = await normalizeWhatsappMultimodalInput({
      media: { type: "image", mediaId: "image-ambiguous", mimeType: "image/jpeg" },
    });

    expect(normalized).toEqual(expect.objectContaining({
      inputModality: "imagem",
      needsClarification: true,
      clarificationQuestion: "Recebi a imagem, mas preciso de uma legenda dizendo se é alimento ou rótulo nutricional.",
    }));
    expect(normalized.mediaContext).toEqual(expect.objectContaining({
      mediaKind: "ambigua",
      extractionConfidence: null,
    }));
  });
});
