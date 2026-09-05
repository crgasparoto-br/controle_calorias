export type CountableFoodRegistrationParityCase = {
  id: string;
  input: string;
  simulatorText: string;
  registrationText: string;
  items: readonly {
    segment: string;
    foodName: string;
    count: number;
    grams: number;
  }[];
};

export const COUNTABLE_FOOD_REGISTRATION_PARITY_CASES = [
  {
    id: "banana-nanica-numeric",
    input: "1 banana nanica",
    simulatorText: "1 banana nanica",
    registrationText: "80 g de banana nanica",
    items: [
      { segment: "1 banana nanica", foodName: "banana nanica", count: 1, grams: 80 },
    ],
  },
  {
    id: "banana-nanica-word",
    input: "uma banana nanica",
    simulatorText: "uma banana nanica",
    registrationText: "80 g de banana nanica",
    items: [
      { segment: "uma banana nanica", foodName: "banana nanica", count: 1, grams: 80 },
    ],
  },
  {
    id: "banana-prata-alias",
    input: "1 banana prata",
    simulatorText: "1 un banana prata",
    registrationText: "80 g de banana prata",
    items: [
      { segment: "1 banana prata", foodName: "banana prata", count: 1, grams: 80 },
    ],
  },
  {
    id: "multi-item-alias",
    input: "1 banana nanica, 1 maca fuji",
    simulatorText: "1 banana nanica, 1 maca fuji",
    registrationText: "80 g de banana nanica\n130 g de maca fuji",
    items: [
      { segment: "1 banana nanica", foodName: "banana nanica", count: 1, grams: 80 },
      { segment: "1 maca fuji", foodName: "maca fuji", count: 1, grams: 130 },
    ],
  },
] as const satisfies readonly CountableFoodRegistrationParityCase[];
