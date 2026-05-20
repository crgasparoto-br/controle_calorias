type MealMedia = {
  mediaType?: string;
  storageUrl?: string | null;
};

type MealWithImage = {
  id: number;
  media?: MealMedia[];
  imageUrl?: string;
  supportingImageUrl?: string;
  photoUrl?: string;
};

const imageUrlsByMealId = new Map<number, string>();

export function registerMealImageUrl(mealId: number, imageUrl?: string | null) {
  if (!imageUrl) return;
  imageUrlsByMealId.set(mealId, imageUrl);
}

export function resolveMealImageUrl(meal: MealWithImage) {
  return (
    meal.supportingImageUrl
    ?? meal.imageUrl
    ?? meal.photoUrl
    ?? imageUrlsByMealId.get(meal.id)
    ?? meal.media?.find(media => media.mediaType === "image" && media.storageUrl)?.storageUrl
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
