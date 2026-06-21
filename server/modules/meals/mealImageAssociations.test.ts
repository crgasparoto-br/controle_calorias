import { describe, expect, it } from "vitest";
import { decorateMealWithImageUrl, registerMealImageUrl, resolveMealImageUrl } from "./mealImageAssociations";

describe("meal image URL association", () => {
  it("mantém URLs públicas de imagem sem alteração", () => {
    expect(resolveMealImageUrl({
      id: 1,
      media: [{
        mediaType: "image",
        storageKey: "public/media/photo.jpg",
        storageUrl: "https://storage.test/public/media/photo.jpg",
      }],
    })).toBe("https://storage.test/public/media/photo.jpg");
  });

  it("converte chave privada de imagem em rota carregável pelo app", () => {
    expect(resolveMealImageUrl({
      id: 2,
      media: [{
        mediaType: "image",
        storageKey: "private/media/photo.jpg",
        storageUrl: "r2://controle-calorias/private/media/photo.jpg",
      }],
    })).toBe("/api/media?key=private%2Fmedia%2Fphoto.jpg");
  });

  it("recupera a chave privada a partir da URL interna antiga", () => {
    expect(resolveMealImageUrl({
      id: 3,
      media: [{
        mediaType: "image",
        storageUrl: "r2://controle-calorias/private/media/old-photo.png",
      }],
    })).toBe("/api/media?key=private%2Fmedia%2Fold-photo.png");
  });

  it("normaliza URLs registradas em memória antes de decorar a refeição", () => {
    registerMealImageUrl(4, "r2://controle-calorias/private/media/registered.jpeg");

    expect(decorateMealWithImageUrl({ id: 4 })).toEqual({
      id: 4,
      imageUrl: "/api/media?key=private%2Fmedia%2Fregistered.jpeg",
      supportingImageUrl: "/api/media?key=private%2Fmedia%2Fregistered.jpeg",
    });
  });
});
