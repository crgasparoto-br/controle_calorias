import { describe, expect, it } from "vitest";
import {
  filtersFromLocation,
  filtersToLocation,
  requestAccessErrorMessage,
} from "./ProfessionalPatients";

describe("ProfessionalPatients URL contract", () => {
  it("restores all valid filters and pagination from the URL", () => {
    const filters = filtersFromLocation(
      "/professional/patients?search=ana&authorization=approved&tracking=paused&activity=inactive&review=overdue&page=3"
    );

    expect(filters).toEqual({
      search: "ana",
      authorizationStatus: "approved",
      trackingStatus: "paused",
      activity: "inactive",
      nextReview: "overdue",
      page: 3,
      pageSize: 20,
    });
    expect(filtersToLocation(filters)).toBe(
      "/professional/patients?search=ana&authorization=approved&tracking=paused&activity=inactive&review=overdue&page=3"
    );
  });

  it("normalizes invalid query values without preserving unsafe state", () => {
    expect(
      filtersFromLocation(
        "/professional/patients?authorization=unknown&tracking=wrong&activity=x&review=y&page=-2"
      )
    ).toEqual({
      search: "",
      authorizationStatus: "all",
      trackingStatus: "all",
      activity: "all",
      nextReview: "all",
      page: 1,
      pageSize: 20,
    });
  });
});

describe("ProfessionalPatients safe request errors", () => {
  it.each(["FORBIDDEN", "NOT_FOUND", "BAD_REQUEST"])(
    "does not enumerate patient state for %s",
    code => {
      expect(requestAccessErrorMessage({ data: { code } })).toBe(
        "Não foi possível enviar a solicitação com os dados informados. Confira o contato ou tente novamente mais tarde."
      );
    }
  );

  it("uses a generic message for unexpected failures", () => {
    expect(requestAccessErrorMessage(new Error("Failed query: users"))).toBe(
      "Não foi possível enviar a solicitação agora. Tente novamente em alguns instantes."
    );
  });
});
