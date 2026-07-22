import "dotenv/config";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { shouldEnableRuntimeDatabaseSsl } from "../server/db";
import { createQuickEditLinkForMeal } from "../server/modules/quickEdit/service";
import { updateQuickEditMealWithWhatsappConfirmation } from "../server/modules/quickEdit/mealUpdateConfirmation";

const databaseUrl = process.env.DATABASE_URL;
const TEST_USER_ID = 874001;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for the quick edit TiDB integration test."
  );
}

async function main() {
  process.env.QUICK_EDIT_BASE_URL = "https://app.example.test";
  const connection = await mysql.createConnection(
    shouldEnableRuntimeDatabaseSsl(databaseUrl)
      ? { uri: databaseUrl, ssl: { minVersion: "TLSv1.2" } }
      : databaseUrl
  );
  let mealId = 0;
  let foodId = 0;
  try {
    await connection.query("DELETE FROM quickEditTokens WHERE userId = ?", [
      TEST_USER_ID,
    ]);
    await connection.query(
      "DELETE mi FROM mealItems mi INNER JOIN meals m ON m.id = mi.mealId WHERE m.userId = ?",
      [TEST_USER_ID]
    );
    await connection.query("DELETE FROM meals WHERE userId = ?", [
      TEST_USER_ID,
    ]);
    await connection.query("DELETE FROM userProfiles WHERE userId = ?", [
      TEST_USER_ID,
    ]);
    await connection.query("DELETE FROM foods WHERE normalized_name = ?", [
      "queijo parmesao polenghi issue 874",
    ]);
    await connection.query("DELETE FROM users WHERE id = ?", [TEST_USER_ID]);
    await connection.query(
      "INSERT INTO users (id, openId, name, email, role) VALUES (?, ?, ?, ?, 'user')",
      [
        TEST_USER_ID,
        "quick-edit-issue-874",
        "Quick Edit Issue 874",
        "quick-edit-issue-874@example.com",
      ]
    );
    await connection.query(
      "INSERT INTO userProfiles (userId, timezone, locale) VALUES (?, 'America/Sao_Paulo', 'pt-BR')",
      [TEST_USER_ID]
    );
    const [foodResult] = await connection.query<mysql.ResultSetHeader>(
      `INSERT INTO foods (
        owner_user_id, name, normalized_name, status,
        calories_kcal_per_100g, protein_grams_per_100g,
        carbs_grams_per_100g, fat_grams_per_100g,
        fiber_grams_per_100g, sodium_mg_per_100g
      ) VALUES (?, ?, ?, 'active', 420, 33.3, 3.3, 30, 0, 650)`,
      [
        TEST_USER_ID,
        "Queijo parmesão Polenghi Issue 874",
        "queijo parmesao polenghi issue 874",
      ]
    );
    foodId = Number(foodResult.insertId);
    const [mealResult] = await connection.query<mysql.ResultSetHeader>(
      "INSERT INTO meals (userId, source, status, mealLabel, sourceText, confidence, occurredAt) VALUES (?, 'whatsapp', 'confirmed', 'Lanche', 'imagem', 0.8, ?)",
      [TEST_USER_ID, new Date("2026-07-22T15:00:00.000Z")]
    );
    mealId = Number(mealResult.insertId);
    await connection.query(
      `INSERT INTO mealItems (
        mealId, itemType, foodName, canonicalName, portionText,
        quantity, unit, servings, estimatedGrams,
        calories, protein, carbs, fat, source
      ) VALUES (?, 'food', '30G', '1 porção', '30 g', 30, 'g', 1, 30, 150, 6, 15, 5, 'heuristic')`,
      [mealId]
    );

    const link = await createQuickEditLinkForMeal({
      userId: TEST_USER_ID,
      mealId,
    });
    const updated = await updateQuickEditMealWithWhatsappConfirmation(
      link.token,
      {
        mealLabel: "Lanche",
        dateTimeLocal: "2026-07-22T12:00",
        items: [
          {
            foodId,
            foodName: "Queijo parmesão Polenghi Issue 874",
            canonicalName: "Queijo parmesão Polenghi Issue 874",
            portionText: "30 g",
            quantity: 30,
            unit: "g",
            servings: 1,
            estimatedGrams: 30,
            calories: 999,
            protein: 999,
            carbs: 999,
            fat: 999,
            confidence: 0.9,
            source: "catalog",
          },
        ],
      }
    );
    assert.equal(updated.id, mealId);

    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT foodId, grams, caloriesKcal, proteinG, carbG, fatG,
              foodSnapshotJson, foodName, canonicalName, calories, protein, carbs, fat
       FROM mealItems WHERE mealId = ?`,
      [mealId]
    );
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(Number(row.foodId), foodId);
    assert.equal(Number(row.grams), 30);
    assert.equal(Number(row.caloriesKcal), 126);
    assert.equal(Number(row.proteinG), 9.99);
    assert.equal(Number(row.carbG), 0.99);
    assert.equal(Number(row.fatG), 9);
    assert.equal(Number(row.calories), 126);
    assert.equal(Number(row.protein), 9.99);
    assert.equal(Number(row.carbs), 0.99);
    assert.equal(Number(row.fat), 9);
    assert.equal(row.canonicalName, "Queijo parmesão Polenghi Issue 874");
    const snapshot = JSON.parse(String(row.foodSnapshotJson));
    assert.equal(snapshot.foodId, foodId);
    assert.equal(snapshot.grams, 30);
    assert.equal(snapshot.calculated.caloriesKcal, 126);
  } finally {
    await connection.query("DELETE FROM quickEditTokens WHERE userId = ?", [
      TEST_USER_ID,
    ]);
    if (mealId)
      await connection.query("DELETE FROM mealItems WHERE mealId = ?", [
        mealId,
      ]);
    await connection.query("DELETE FROM meals WHERE userId = ?", [
      TEST_USER_ID,
    ]);
    if (foodId)
      await connection.query("DELETE FROM foods WHERE id = ?", [foodId]);
    await connection.query("DELETE FROM userProfiles WHERE userId = ?", [
      TEST_USER_ID,
    ]);
    await connection.query("DELETE FROM users WHERE id = ?", [TEST_USER_ID]);
    await connection.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
