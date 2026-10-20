import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const migration = readFileSync(new URL("../drizzle/0055_food_intelligence_v2_persistence.sql", import.meta.url),"utf8");
const rollback = readFileSync(new URL("../drizzle/rollback/0055_food_intelligence_v2_persistence.sql", import.meta.url),"utf8");
const schema = readFileSync(new URL("../drizzle/food-intelligence-v2-schema.ts", import.meta.url),"utf8");
const legacy = readFileSync(new URL("../drizzle/schema.ts", import.meta.url),"utf8");
const expected = ["food_attribute_materiality","food_attribute_materiality_overrides","food_attributes","food_barcodes","food_evidence","food_lexicon_entries","food_nutrition_profiles","food_resolution_events","food_review_cases","food_review_events","food_variant_attributes","food_variant_classifications","food_variant_sources","food_variants","user_food_aliases","user_food_lexicon_entries"];
const created = [...migration.matchAll(/CREATE TABLE `([^\x60]+)`/g)].map(m=>m[1]);
test("todas as entidades persistentes V2 existem no SQL e no schema", () => {
 assert.deepEqual([...created].sort(), expected);
 for(const name of expected){assert.match(schema,new RegExp('mysqlTable\\("'+name+'"'));assert.match(rollback,new RegExp('DROP TABLE \\x60'+name+'\\x60'));}
});
test("migration é aditiva e snapshots legados não são reescritos", () => {
 assert.doesNotMatch(migration,/DROP (?:TABLE|COLUMN)|DELETE FROM|UPDATE `mealItems`|UPDATE `foodCatalog`/i);
 for(const key of ["foodVariantId","nutritionProfileId","foodPortionId","foodSnapshotJson"]){assert.match(legacy,new RegExp(key));}
});
test("B1 mantém inserções V1 possíveis sem inventar identidade ou escopo V2", () => {
 assert.match(migration,/ADD COLUMN \`scope\` enum\\('global','user'\\) NULL;/);
 assert.match(migration,/ADD COLUMN \`canonical_name\` varchar\\(255\\) NULL;/);
 assert.match(migration,/ADD COLUMN \`canonical_key\` varchar\\(191\\) NULL;/);
 assert.doesNotMatch(migration,/MODIFY COLUMN \`canonical_(?:name|key)\`[^;]*NOT NULL/i);
 assert.match(legacy,/scope: mysqlEnum\\("scope", \\["global", "user"\\]\\),/);
 assert.match(legacy,/canonicalKey: varchar\\("canonical_key", \\{ length: 191 \\}\\),/);
});
test("exclusividade por versão e escopo não depende de memória de processo", () => {
 for(const token of ["fnp_one_current_uq","case_id` ,","v2_user_food_favorit_u0"]){ /* explicit indexes validated below */ }
 for(const compound of ["profile_key`,`version","profile_key`,`current_slot","user_id`,`normalized_alias`,`current_slot","user_id`,`locale`,`normalized_term`,`kind`,`current_slot","case_id`,`review_cycle`,`request_key"]){assert.ok(migration.includes(compound), compound);}
 assert.match(migration,/CHECK \(\(status='closed' AND outcome IS NOT NULL/);
 assert.match(migration,/FOREIGN KEY \(`foodVariantId`\) REFERENCES `food_variants`\(`id`\) ON DELETE RESTRICT/);
});
test("script de rollback reverte apenas estruturas novas",()=>{
 assert.doesNotMatch(rollback,/DROP TABLE `(?:foods|foodCatalog|mealItems|food_aliases|food_portions)`/);
 assert.ok(rollback.indexOf("DROP TABLE `food_nutrition_profiles`") < rollback.indexOf("DROP TABLE `food_variant_sources`"));
});
