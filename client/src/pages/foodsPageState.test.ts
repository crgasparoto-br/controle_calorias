import { describe, expect, it } from "vitest";
import { canDeleteLegacyFood, getFoodCardActionState } from "./foodsPageState";

describe("foods page action state", () => {
  it("allows deletion only for an entry created by the current user", () => {
    expect(
      canDeleteLegacyFood({
        isUserCreated: true,
        createdByUserId: 7,
        currentUserId: 7,
      })
    ).toBe(true);
    expect(
      canDeleteLegacyFood({
        isUserCreated: true,
        createdByUserId: 8,
        currentUserId: 7,
      })
    ).toBe(false);
    expect(
      canDeleteLegacyFood({
        isUserCreated: false,
        createdByUserId: null,
        currentUserId: 7,
      })
    ).toBe(false);
  });

  it("blocks edit, favorite and duplicate delete actions while deleting", () => {
    expect(
      getFoodCardActionState({
        isFavoritePending: false,
        isDeletePending: true,
      })
    ).toEqual({
      editDisabled: true,
      favoriteDisabled: true,
      deleteDisabled: true,
    });
  });

  it("keeps only favorite blocked during a favorite mutation", () => {
    expect(
      getFoodCardActionState({
        isFavoritePending: true,
        isDeletePending: false,
      })
    ).toEqual({
      editDisabled: false,
      favoriteDisabled: true,
      deleteDisabled: false,
    });
  });
});
