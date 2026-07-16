export function canDeleteLegacyFood(params: {
  isUserCreated: boolean;
  createdByUserId?: number | null;
  currentUserId?: number | null;
}) {
  return (
    params.isUserCreated &&
    params.currentUserId != null &&
    params.createdByUserId === params.currentUserId
  );
}

export function getFoodCardActionState(params: {
  isFavoritePending: boolean;
  isDeletePending: boolean;
}) {
  return {
    editDisabled: params.isDeletePending,
    favoriteDisabled: params.isFavoritePending || params.isDeletePending,
    deleteDisabled: params.isDeletePending,
  };
}
