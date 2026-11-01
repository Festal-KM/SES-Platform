import { describe, it, expect } from 'vitest';
import { redactMonitoringEvent } from './monitoring.js';
describe('運用監視へ業務情報・秘密値を渡さない', () => {
  it('本文・認証・利用者・パンくず・例外の文字列・ローカル変数を落とし、コード位置は残す', () => {
    const event = { user: { email: 'private@example.invalid' }, request: { headers: { authorization: 'private-token' }, data: 'private-profile' },
      breadcrumbs: [{ message: 'private-name' }], contexts: { database: 'private-database-url' }, extra: { sheet: 'private-sheet' },
      message: 'private-message', transaction: '/private-tenant', logentry: { message: 'private-log' },
      exception: { values: [{ type: 'TypeError', value: 'private-error', stacktrace: { frames: [{ filename: '/app/module.js', lineno: 12, vars: { key: 'private-key' }, context_line: 'private-source' }] } }] },
    };
    const result = redactMonitoringEvent(event);
    expect(JSON.stringify(result)).not.toContain('private-');
    expect(result.exception.values[0].type).toBe('TypeError');
    expect(result.exception.values[0].stacktrace.frames[0]).toEqual({ filename: '/app/module.js', lineno: 12 });
  });
  it('例外・リクエストのないイベントでも扱える', () => {
    expect(redactMonitoringEvent({ message: 'private-message' })).toEqual({ message: 'Application error' });
  });
});
