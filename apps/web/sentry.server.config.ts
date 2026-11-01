// Sentryには顧客データ・リクエスト本文・トークンを送らない。
// 🔴 ここで起動時の設定を読み直さない（`initializeRuntimeConfig` を呼んでよいのは起動経路の
//    `instrumentation.ts` だけ。`tests/static/startup-di-callers.test.ts`）。解決済みの値を受け取る。
import * as Sentry from '@sentry/nextjs';
import { MONITORING_DATA_COLLECTION, redactMonitoringEvent, type RuntimeConfig } from '@ses/config';

export function initServerMonitoring(env: RuntimeConfig['env']): void {
  if (!env.SENTRY_DSN) return;
  Sentry.init({ dsn: env.SENTRY_DSN, environment: env.APP_ENV, dataCollection: MONITORING_DATA_COLLECTION,
    tracePropagationTargets: [],
    tracesSampleRate: 0, beforeSend: (event) => redactMonitoringEvent(event),
    integrations: (defaults) => defaults.filter((integration) => !['Console', 'LocalVariables', 'RequestData'].includes(integration.name)),
  });
}
