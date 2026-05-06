ALTER TABLE `foodCatalog`
  ADD COLUMN `isFruit` int NOT NULL DEFAULT 0,
  ADD COLUMN `isVegetable` int NOT NULL DEFAULT 0,
  ADD COLUMN `isUltraProcessed` int NOT NULL DEFAULT 0;
