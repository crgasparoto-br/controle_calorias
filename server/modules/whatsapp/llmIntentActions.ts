@@
-const UNSWEETENED_COFFEE_REFERENCE = FOOD_CATALOG_REFERENCE.find(
-  food => food.slug === "cafe-sem-acucar",
-);
-
-if (!UNSWEETENED_COFFEE_REFERENCE) {
-  throw new Error("A referência canônica de café sem açúcar não está disponível.");
-}
+function getRequiredUnsweetenedCoffeeReference() {
+  const reference = FOOD_CATALOG_REFERENCE.find(
+    food => food.slug === "cafe-sem-acucar",
+  );
+  if (!reference) {
+    throw new Error("A referência canônica de café sem açúcar não está disponível.");
+  }
+  return reference;
+}
+
+const UNSWEETENED_COFFEE_REFERENCE = getRequiredUnsweetenedCoffeeReference();