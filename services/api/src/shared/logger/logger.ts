import pino from 'pino';
import { config } from '../../config';

export const logger = pino({
  level: config.logLevel,
  ...(config.nodeEnv === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {
        // Production: JSON logs for log aggregation
        formatters: {
          level: (label) => ({ level: label }),
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }),
  base: {
    service: 'controle-calorias-api',
    env: config.nodeEnv,
  },
  redact: {
    paths: [
      'headers.authorization',
      'body.password',
      'body.token',
      'whatsappAccessToken',
      'openaiApiKey',
    ],
    censor: '[REDACTED]',
  },
});
