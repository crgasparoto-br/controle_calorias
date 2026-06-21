type MealMedia = {
  mediaType?: string;
  storageKey?: string | null;
  storageUrl?: string | null;
};

type MealWithImage = {
  id: number;
  media?: MealMedia[];
  imageUrl?: string | null;
  supportingImageUrl?: string | null;
  photoUrl?: string | null;
};

const imageUrlsByMealId = new Map<number, string>();

function parseInternalR2StorageKey(imageUrl?: string | null) {
  if (!imageUrl?.startsWith("r2://")) {
    return null;
  }

  const withoutProtocol = imageUrl.slice("r2://".length);
  const keyStart = withoutProtocol.indexOf("/");
  if (keyStart === -1) {
    return null;
  }

  const key = withoutProtocol.slice(keyStart + 1).trim();
  return key || null;
}

function buildMediaProxyUrl(storageKey: string) {
  return `/api/media?key=${encodeURIComponent(storageKey)}`;
}

function normalizeImageUrl(imageUrl?: string | null, storageKey?: string | null) {
  if (imageUrl && !imageUrl.startsWith("r2://")) {
    return imageUrl;
  }

  const key = storageKey?.trim() || parseInternalR2StorageKey(imageUrl);
  return key ? buildMediaProxyUrl(key) : undefined;
}

export function registerMealImageUrl(mealId: number, imageUrl?: string | null) {
  const normalizedImageUrl = normalizeImageUrl(imageUrl);
  if (!normalizedImageUrl) return;
  imageUrlsByMealId.set(mealId, normalizedImageUrl);
}

export function resolveMealImageUrl(meal: MealWithImage) {
  const imageMedia = meal.media?.find(media => media.mediaType === "image" && (media.storageUrl || media.storageKey));

  return (
    normalizeImageUrl(meal.supportingImageUrl)
    ?? normalizeImageUrl(meal.imageUrl)
    ?? normalizeImageUrl(meal.photoUrl)
    ?? normalizeImageUrl(imageUrlsByMealId.get(meal.id))
    ?? normalizeImageUrl(imageMedia?.storageUrl, imageMedia?.storageKey)
    ?? undefined
  );
}

export function decorateMealWithImageUrl<T extends MealWithImage>(meal: T): T & { imageUrl?: string; supportingImageUrl?: string } {
  const imageUrl = resolveMealImageUrl(meal);
  if (!imageUrl) {
    return meal;
  }

  return {
    ...meal,
    imageUrl,
    supportingImageUrl: imageUrl,
  };
}
