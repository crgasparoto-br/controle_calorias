import { getDb, logPersistenceWarning } from "../../db";
import { createDrizzleProfessionalContentRepository } from "../../repositories/professionalContentRepository";

export const professionalContentRepository =
  createDrizzleProfessionalContentRepository({
    getDb,
    onWarning: logPersistenceWarning,
  });
