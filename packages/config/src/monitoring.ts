/** SDKの自動収集を止める。HTTP本文・AI入出力・キュー引数も対象とする。 */
export const MONITORING_DATA_COLLECTION = {
  userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
  graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false }, databaseQueryData: false, queues: false,
  stackFrameVariables: false, frameContextLines: 0,
};

/** 運用監視には業務データを送らず、例外の種類とコード位置だけを残す。 */
export function redactMonitoringEvent<T extends {
  user?: unknown; request?: unknown; breadcrumbs?: unknown; extra?: unknown; contexts?: unknown;
  message?: string; logentry?: unknown; transaction?: string;
  exception?: { values?: { value?: string; stacktrace?: { frames?: { vars?: unknown; context_line?: string; pre_context?: unknown; post_context?: unknown }[] } }[] };
}>(event: T): T {
  delete event.user;
  delete event.request;
  delete event.breadcrumbs;
  delete event.extra;
  delete event.contexts;
  delete event.logentry;
  delete event.transaction;
  if (event.message) event.message = 'Application error';
  for (const exception of event.exception?.values ?? []) {
    exception.value = 'Error details omitted';
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars; delete frame.context_line; delete frame.pre_context; delete frame.post_context;
    }
  }
  return event;
}
