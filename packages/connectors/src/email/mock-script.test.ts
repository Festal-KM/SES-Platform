// packages/connectors/src/email/mock-script.test.ts
// T-09-07: モックの台本の検証（`parseMockEmailScript`）。E2E ハーネス（T-09-11）が環境 / JSON から注入するときの入口。
import { describe, expect, it } from 'vitest';

import { MOCK_EMAIL_STEP_KINDS, MockEmailScriptError, parseMockEmailScript } from './mock-script.js';

describe('parseMockEmailScript', () => {
  it('4 種の kind を受け付け、providerCode は任意', () => {
    expect(
      parseMockEmailScript([
        { kind: 'deliver' },
        { kind: 'unknown' },
        { kind: 'unreachable', providerCode: 'ENOTFOUND' },
        { kind: 'reject', providerCode: 'MessageRejected' },
      ]),
    ).toEqual([
      { kind: 'deliver' },
      { kind: 'unknown' },
      { kind: 'unreachable', providerCode: 'ENOTFOUND' },
      { kind: 'reject', providerCode: 'MessageRejected' },
    ]);
    expect(MOCK_EMAIL_STEP_KINDS).toEqual(['deliver', 'unknown', 'unreachable', 'reject']);
  });

  it('空配列は空配列（= 常に deliver。未設定を例外にしない）', () => {
    expect(parseMockEmailScript([])).toEqual([]);
  });

  it.each([
    ['配列でない', { kind: 'unknown' }],
    ['要素がオブジェクトでない', ['unknown']],
    ['未知の kind', [{ kind: 'retry' }]],
    ['kind が無い', [{ providerCode: 'X' }]],
    ['providerCode が文字列でない', [{ kind: 'unknown', providerCode: 5 }]],
    ['providerCode が空', [{ kind: 'reject', providerCode: '  ' }]],
  ])('🔴 不正な台本は MockEmailScriptError（既定値で補完しない）: %s', (_label, raw) => {
    expect(() => parseMockEmailScript(raw)).toThrow(MockEmailScriptError);
  });

  it('deliver に providerCode が付いていても捨てる（意味を持たない項目を残さない）', () => {
    expect(parseMockEmailScript([{ kind: 'deliver', providerCode: 'ignored' }])).toEqual([{ kind: 'deliver' }]);
  });
});
