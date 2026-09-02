// packages/config/src/errors.ts
// 起動時検証で使うエラー型。docs/05 §13.4 規則 4/5/6:
// 「どの変数が、なぜ不正かを列挙する」「1 つ目で止めない」「値そのものはログ・メッセージに出さない」。

export interface EnvValidationIssue {
  /** 問題のあった環境変数名（複数フィールドにまたがる場合はドット区切り）。値は含まない。 */
  readonly variable: string;
  /** 不正の理由。変数名と理由のみで、実際の値は含めない（CLAUDE.md §3.5 / docs/05 §13.4 規則 6）。 */
  readonly message: string;
}

/**
 * `packages/config` の起動時検証が失敗したときに投げる唯一のエラー型。
 * 呼び出し元（apps/web の instrumentation.ts / apps/worker の main.ts）で
 * catch せずにそのまま伝播させれば、プロセスの起動が失敗する（NFR-ENV-3 / NFR-ENV-4 の実現手段）。
 */
export class EnvValidationError extends Error {
  readonly issues: readonly EnvValidationIssue[];

  constructor(issues: readonly EnvValidationIssue[]) {
    const summary = issues.map((issue) => `  - ${issue.variable}: ${issue.message}`).join('\n');
    super(`環境変数の検証に失敗しました（${issues.length} 件）。値はログに出しません。\n${summary}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/** production で mock 実装が選択されたときに投げる（NFR-ENV-3 の型安全に加えた実行時の二重防御）。 */
export class ProductionMockConnectorError extends Error {
  constructor(category: string) {
    super(
      `production で「${category}」に mock 実装が選択されました。CLAUDE.md §11.1 の禁止事項のため起動を中止します。`,
    );
    this.name = 'ProductionMockConnectorError';
  }
}
