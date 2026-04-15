import { PrismaClient } from '@prisma/client';
import { logger } from '../logger/logger';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Reuse instance in development to prevent connection pool exhaustion
export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [{ level: 'error', emit: 'stdout' }, { level: 'warn', emit: 'stdout' }]
        : [{ level: 'error', emit: 'stdout' }],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

// Log unhandled Prisma errors
process.on('unhandledRejection', (reason) => {
  if (reason instanceof Error && reason.message.includes('PrismaClient')) {
    logger.error({ message: reason.message }, 'Unhandled Prisma error');
  }
});
