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

  it("preserva quebras de linha para separacao de hidratacao e alimentos", async () => {
    const normalized = await normalizeWhatsappMultimodalInput({
      text: "3 bisnaguinhas panco\n300 ml água\n19 gramas de mel",
    });

    expect(normalized.originalText).toBe("3 bisnaguinhas panco\n300 ml água\n19 gramas de mel");
    expect(normalized.routerText).toBe("3 bisnaguinhas panco\n300 ml água\n19 g de mel");
  });

  it("normaliza erros de acento, abreviacoes e marca incompleta preservando texto original", async () => {
    const normalized = await normalizeWhatsappMultimodalInput({ text: "1 cafe lor e pao c queijo" });

    expect(normalized.originalText).toBe("1 cafe lor e pao c queijo");
    expect(normalized.routerText).toBe("1 café L'or e pão com queijo");
    expect(normalized.informalNormalization.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ original: "cafe", normalized: "café", kind: "typo" }),
      expect.objectContaining({ original: "lor", normalized: "L'or", kind: "brand" }),
      expect.objectContaining({ original: "pao", normalized: "pão", kind: "typo" }),
      expect.objectContaining({ original: "c queijo", normalized: "com queijo", kind: "abbreviation" }),
    ]));
    expect(normalized.informalNormalization.candidateAliases).toEqual(expect.arrayContaining([
      expect.objectContaining({ alias: "lor", candidate: "L'or", kind: "brand" }),
    ]));
  });

  it("mantem marca e alimento em abreviacoes comuns", async () => {
    const normalized = await normalizeWhatsappMultimodalInput({ text: "refri zero e miojo turma da monica" });

    expect(normalized.routerText).toBe("refrigerante zero açúcar e macarrão instantâneo Turma da Mônica");
    expect(normalized.informalNormalization.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ original: "refri", normalized: "refrigerante", kind: "abbreviation" }),
      expect.objectContaining({ original: "zero", normalized: "zero açúcar", kind: "brand" }),
      expect.objectContaining({ original: "miojo turma da monica", normalized: "macarrão instantâneo Turma da Mônica", kind: "brand" }),
    ]));
  });

  it("pede esclarecimento para quantidade informal incerta", async () => {
    const normalized = await normalizeWhatsappMultimodalInput({ text: "um tiquinho de azeite" });

    expect(normalized.routerText).toBe("pequena quantidade de azeite");
    expect(normalized.needsClarification).toBe(true);
    expect(normalized.clarificationQuestion).toBe("Entendi uma quantidade informal. Pode confirmar a porção aproximada para eu registrar com segurança?");
    expect(normalized.informalNormalization.uncertainTerms).toContain("um tiquinho de");
  });

  it("normaliza plural simples em quantidade sem pedir esclarecimento", async () => {
    const normalized = await normalizeWhatsappMultimodalInput({ text: "2 fatia pão integral" });

    expect(normalized.routerText).toBe("2 fatias pão integral");
    expect(normalized.needsClarification).toBe(false);
    expect(normalized.informalNormalization.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ original: "2 fatia", normalized: "2 fatias", kind: "portion" }),
    ]));
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

  it("normaliza linguagem informal de audio transcrito", async () => {
    const normalized = await normalizeWhatsappMultimodalInput({
      media: { type: "audio", transcription: "comi pao c queijo" },
    });

    expect(normalized.inputModality).toBe("audio");
    expect(normalized.transcribedText).toBe("comi pao c queijo");
    expect(normalized.routerText).toBe("comi pão com queijo");
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

  it("normaliza linguagem informal em legenda de imagem", async () => {
    const normalized = await normalizeWhatsappMultimodalInput({
      media: {
        type: "image",
        caption: "pratao de macarrao",
      },
    });

    expect(normalized.inputModality).toBe("imagem_com_legenda");
    expect(normalized.routerText).toContain("prato grande de macarrão");
    expect(normalized.needsClarification).toBe(true);
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
