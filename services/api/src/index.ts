import { app } from './app';
import { config } from './config';
import { logger } from './shared/logger/logger';
import { prisma } from './shared/database/prisma';
import { redisClient } from './shared/cache/redis';
import { startWorkers } from './workers';

const start = async (): Promise<void> => {
  try {
    // Test database connection
    await prisma.$connect();
    logger.info('✅ Database connected');

    // Test Redis connection
    await redisClient.ping();
    logger.info('✅ Redis connected');

    // Start queue workers
    startWorkers();

    // Start server
    await app.listen({ port: config.port, host: '0.0.0.0' });
    logger.info(`🚀 Server running on port ${config.port}`);
    logger.info(`📚 Swagger docs: http://localhost:${config.port}/docs`);
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
};

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await app.close();
  await prisma.$disconnect();
  redisClient.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await app.close();
  await prisma.$disconnect();
  redisClient.disconnect();
  process.exit(0);
});

start();
