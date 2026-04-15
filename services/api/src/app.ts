import Fastify, { type FastifyError } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyMultipart from '@fastify/multipart';
import { config } from './config';
import { logger } from './shared/logger/logger';
import { metricsRoute } from './shared/metrics/metrics';
import { whatsappRoutes } from './modules/whatsapp/whatsapp.routes';
import { usersRoutes } from './modules/users/users.routes';
import { mealsRoutes } from './modules/meals/meals.routes';
import { healthRoutes } from './modules/health/health.routes';

export const app = Fastify({
  logger: false, // we use pino directly
  trustProxy: true,
});

// -----------------------------------------------------------------------
// Security
// -----------------------------------------------------------------------
app.register(fastifyHelmet, {
  contentSecurityPolicy: false,
});

app.register(fastifyCors, {
  origin: config.corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
});

app.register(fastifyRateLimit, {
  max: config.rateLimitMax,
  timeWindow: config.rateLimitWindowMs,
});

// -----------------------------------------------------------------------
// Auth
// -----------------------------------------------------------------------
app.register(fastifyJwt, {
  secret: config.jwtSecret,
});

// -----------------------------------------------------------------------
// File upload
// -----------------------------------------------------------------------
app.register(fastifyMultipart, {
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// -----------------------------------------------------------------------
// Swagger Documentation
// -----------------------------------------------------------------------
app.register(fastifySwagger, {
  openapi: {
    info: {
      title: 'Controle Calorias API',
      description: 'SaaS de controle de calorias e nutrientes com WhatsApp',
      version: '1.0.0',
    },
    servers: [{ url: config.apiBaseUrl }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
});

app.register(fastifySwaggerUi, {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: true,
  },
});

// -----------------------------------------------------------------------
// Hooks
// -----------------------------------------------------------------------
app.addHook('onRequest', (request, _reply, done) => {
  logger.info(
    { method: request.method, url: request.url, requestId: request.id },
    'Incoming request',
  );
  done();
});

app.addHook('onResponse', (request, reply, done) => {
  logger.info(
    {
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime,
    },
    'Request completed',
  );
  done();
});

// -----------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------
app.register(healthRoutes, { prefix: '/health' });
app.register(metricsRoute, { prefix: '/metrics' });
app.register(whatsappRoutes, { prefix: '/webhook' });
app.register(usersRoutes, { prefix: '/api/v1/users' });
app.register(mealsRoutes, { prefix: '/api/v1/meals' });

// -----------------------------------------------------------------------
// Error handler
// -----------------------------------------------------------------------
app.setErrorHandler((error: FastifyError, request, reply) => {
  logger.error({ error, requestId: request.id }, 'Unhandled error');

  if (error.statusCode) {
    return reply.status(error.statusCode).send({
      error: error.name,
      message: error.message,
      statusCode: error.statusCode,
    });
  }

  return reply.status(500).send({
    error: 'InternalServerError',
    message: 'An unexpected error occurred',
    statusCode: 500,
  });
});
