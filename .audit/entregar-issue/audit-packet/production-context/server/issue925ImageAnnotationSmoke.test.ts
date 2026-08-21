import { describe, expect, it } from "vitest";
import { runIssue925ImageAnnotationSmoke } from "./issue925ImageAnnotationSmoke";

describe("issue #925 controlled image smoke", () => {
  it("uses the production local entrypoint with a synthetic photo and separate storage", async () => {
    const result = await runIssue925ImageAnnotationSmoke();

    expect(result).toMatchObject({
      status: "passed",
      mode: "local",
      artifactKind: "photo_annotation",
      degradation: "none",
      sourcePreserved: true,
      derivativeSeparated: true,
      dimensions: { width: 640, height: 480 },
      storageWrites: 1,
    });
    expect(result.storageKey).toMatch(
      /^generated\/meal-annotations\/local-[a-f0-9]{24}\.png$/u,
    );
    expect(result.sourceSha256).not.toBe(result.derivativeSha256);
  });
});
