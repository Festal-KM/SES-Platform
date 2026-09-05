// packages/connectors/src/index.test.ts
// createConnectors（docs/05 §8.1 / §13.1）: 選択結果を instantiate するだけであること、
// 🔴 未登録の実装をモックで代替しないこと（CLAUDE.md §11.1）。
import { describe, expect, it } from 'vitest';

import { createConnectors } from './index.js';
import { ConnectorImplementationNotAvailableError } from './errors.js';
import { MockEmailSender } from './mock/index.js';
import {
  CONNECTOR_CATEGORIES,
  type ConnectorCategory,
  type ConnectorImplementationKind,
  type ConnectorSelectionInput,
} from './types.js';

const allMock: ConnectorSelectionInput = {
  email: 'mock',
  objectStore: 'mock',
  malwareScanner: 'mock',
  esign: 'mock',
  billing: 'mock',
};

function selectionWith(category: ConnectorCategory, kind: ConnectorImplementationKind): ConnectorSelectionInput {
  const next: Record<ConnectorCategory, ConnectorImplementationKind> = { ...allMock };
  next[category] = kind;
  return next;
}

describe('createConnectors', () => {
  it('全区分 mock の選択（demo 相当）で 5 区分すべてが組み立てられる', () => {
    const connectors = createConnectors(allMock);
    expect(connectors.email).toBeInstanceOf(MockEmailSender);
    expect(connectors.email.callCount()).toBe(0);
    expect(connectors.objectStore.callCount()).toBe(0);
    expect(connectors.malwareScanner.callCount()).toBe(0);
    expect(connectors.billing.callCount()).toBe(0);
  });

  it('🔴 esign は「1 実装」ではなく全プロバイダのマップを返す（docs/05 §8.1 / §8.4）', () => {
    const { esign } = createConnectors(allMock);
    expect(esign.mock?.key).toBe('mock');
    // 🔴 未登録のプロバイダは undefined。フォールバックで別プロバイダを選ばない。
    expect(esign.docusign).toBeUndefined();
    expect(esign.cloudsign).toBeUndefined();
  });

  it.each([...CONNECTOR_CATEGORIES])(
    '🔴 %s の実装が未登録（real）なら起動時に throw する（モックに倒さない）',
    (category) => {
      expect(() => createConnectors(selectionWith(category, 'real'))).toThrow(
        ConnectorImplementationNotAvailableError,
      );
    },
  );

  it('🔴 sandboxRecipientScoped（未実装）もモックに倒さず throw する', () => {
    expect(() => createConnectors(selectionWith('email', 'sandboxRecipientScoped'))).toThrow(
      ConnectorImplementationNotAvailableError,
    );
  });

  it('例外は「どの区分のどの実装種別か」を持つ（起動ログから原因が分かる）', () => {
    let captured: unknown = null;
    try {
      createConnectors(selectionWith('email', 'real'));
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(ConnectorImplementationNotAvailableError);
    const typed = captured as ConnectorImplementationNotAvailableError;
    expect(typed.category).toBe('email');
    expect(typed.kind).toBe('real');
    // 🔴 例外メッセージにシークレットを含めない（変数名と理由だけ。docs/05 §13.4 規則 6）。
    expect(typed.message).toContain('email');
  });

  it('呼び出しごとに独立したインスタンスを返す（起動時 1 回の DI を前提にした状態を共有しない）', () => {
    const a = createConnectors(allMock);
    const b = createConnectors(allMock);
    expect(a.email).not.toBe(b.email);
  });
});
