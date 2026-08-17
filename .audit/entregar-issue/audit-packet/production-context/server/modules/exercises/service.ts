import {
  createUserExercise,
  listUserExercises,
  removeUserExercise,
  updateUserExercise,
} from "../../db";
import { ExerciseInput, UpdateExerciseInput } from "./schemas";

export async function listExercises(userId: number) {
  return listUserExercises(userId);
}

export async function createExercise(userId: number, input: ExerciseInput) {
  return createUserExercise(userId, input);
}

export async function updateExercise(userId: number, input: UpdateExerciseInput) {
  return updateUserExercise(userId, input);
}

export async function removeExercise(userId: number, exerciseId: number) {
  return removeUserExercise(userId, exerciseId);
}
