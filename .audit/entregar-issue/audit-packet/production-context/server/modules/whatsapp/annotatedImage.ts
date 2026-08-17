import {
  generateAnnotatedMealImage as generateAnnotatedMealImageImplementation,
} from "./annotatedImageImplementation";
import { recordImageAnnotationResult } from "./imageAnnotationTelemetryContext";

export * from "./annotatedImageImplementation";

export async function generateAnnotatedMealImage(
  ...args: Parameters<typeof generateAnnotatedMealImageImplementation>
): Promise<Awaited<ReturnType<typeof generateAnnotatedMealImageImplementation>>> {
  const result = await generateAnnotatedMealImageImplementation(...args);
  return recordImageAnnotationResult(result);
}
