import { syncFoodCatalogReference } from "../server/foodCatalogSync.ts";

const result = await syncFoodCatalogReference();
console.log(JSON.stringify(result));
