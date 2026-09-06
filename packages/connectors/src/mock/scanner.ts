// packages/connectors/src/mock/scanner.ts
// docs/05 §13.2。`demo` で使う（`development` は ClamAV の実接続 = `real`。docs/05 §13.1）。
//
// 🔴 E2E も `demo` も**この 1 実装**を使う（docs/05 §17.5「テスト専用の別モックを書かない」）。

import type { MalwareScanner } from '../interfaces.js';
import type { ScanResultReading, ScanStatus } from '../types.js';

/** モックが返す既定の版 ID（バージョニング有効なバケットの版に相当する擬似値）。 */
const MOCK_VERSION_ID = 'mock-version-1';

export type MockMalwareScannerOptions = {
  /**
   * 既定の判定。既定値は `CLEAN`。
   * 🔴 `INFECTED` / `UNSCANNABLE` の導線を確かめたい `demo` / E2E は、この既定を変えるか
   *    `setResult()` でキーごとに上書きする（テスト専用の別モックを作らない。docs/05 §17.5）。
   */
  readonly defaultResult?: ScanStatus;
};

export class MockMalwareScanner implements MalwareScanner {
  private readonly results = new Map<string, ScanStatus>();
  private calls = 0;

  constructor(private readonly options: MockMalwareScannerOptions = {}) {}

  async enqueue(key: string): Promise<void> {
    this.calls += 1;
    if (!this.results.has(key)) this.results.set(key, this.options.defaultResult ?? 'CLEAN');
  }

  async getResult(key: string, versionId: string | null): Promise<ScanResultReading | null> {
    this.calls += 1;
    const status =
      (versionId === null ? undefined : this.results.get(this.compositeKey(key, versionId))) ??
      this.results.get(key);
    // 🔴 「まだ判定が無い」は `null`（`SCANNING` を確定結果として返さない。`MalwareScanner` の契約）。
    if (status === undefined || status === 'SCANNING') return null;
    return { status, rawStatus: `mock:${status}`, objectVersionId: versionId ?? MOCK_VERSION_ID };
  }

  /**
   * 判定の上書き（モックの操作 API）。
   * 🔴 `THREATS_FOUND` の後に `NO_THREATS_FOUND` が来ても `CLEAN` に戻さない、という
   *    **安全側への固定は受信パイプライン（`scan.apply-result`）の責務**であり、ここでは行わない。
   *    モックは「プロバイダが何を返したか」だけを表す。
   */
  setResult(key: string, versionId: string | null, status: ScanStatus): void {
    this.results.set(versionId === null ? key : this.compositeKey(key, versionId), status);
  }

  callCount(): number {
    return this.calls;
  }

  /**
   * キー × 版の複合キー。
   *
   * 🔴 区切り文字を自前で決めない（`JSON.stringify` の配列表現をそのまま使う）。理由は 2 つある:
   *    ①区切り文字を選ぶと `'a|b' + 'c'` と `'a' + 'b|c'` の衝突を考える必要が出る
   *    ②制御文字（NUL 等）を区切りに使うと**ソースが binary と判定され、grep / ripgrep ベースの
   *      静的検査・レビュー・diff がこのファイルを素通りする**（T-04-01 レビュー指摘 3）
   */
  private compositeKey(key: string, versionId: string): string {
    return JSON.stringify([key, versionId]);
  }
}
