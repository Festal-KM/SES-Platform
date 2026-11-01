// Sentryには顧客データ・リクエスト本文・トークンを送らない。
import * as Sentry from '@sentry/nextjs';
import { initializeRuntimeConfig, MONITORING_DATA_COLLECTION, redactMonitoringEvent } from '@ses/config';
const { env } = initializeRuntimeConfig(process.env, () => undefined);
if (env.SENTRY_DSN) {
  Sentry.init({ dsn: env.SENTRY_DSN, environment: env.APP_ENV, dataCollection: MONITORING_DATA_COLLECTION,
    tracePropagationTargets: [],
    tracesSampleRate: 0, beforeSend: (event) => redactMonitoringEvent(event),
    integrations: (defaults) => defaults.filter((integration) => !['Console', 'LocalVariables', 'RequestData'].includes(integration.name)),
  });
}
