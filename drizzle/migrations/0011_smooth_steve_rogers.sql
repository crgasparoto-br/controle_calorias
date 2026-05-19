ALTER TABLE `userProfiles` ADD `ageYears` int;--> statement-breakpoint
ALTER TABLE `userProfiles` ADD `currentWeightKg` double;--> statement-breakpoint
ALTER TABLE `userProfiles` ADD `nutritionObjective` enum('emagrecer','manter_peso','ganhar_massa','melhorar_habitos');--> statement-breakpoint
ALTER TABLE `userProfiles` ADD `activityLevel` enum('sedentary','light','moderate','active','very_active');--> statement-breakpoint
ALTER TABLE `userProfiles` ADD `trackingExperience` enum('beginner','intermediate','advanced');--> statement-breakpoint
ALTER TABLE `userProfiles` ADD `eatingRoutine` enum('cozinha_em_casa','come_fora','delivery','marmita','misto');--> statement-breakpoint
ALTER TABLE `userProfiles` ADD `mainDifficulty` enum('fome','ansiedade','falta_de_tempo','beliscos','doces','comer_fora','falta_de_planejamento');--> statement-breakpoint
ALTER TABLE `userProfiles` ADD `onboardingCompletedAt` timestamp;