// apps/web/lib/forms/submit-guard.ts
// 送信中の二重実行を防ぐ最小のガード（docs/04 §S-046 ほか「送信中はボタンを送信中表示に
// 置換（二重送信防止）」という繰り返し出てくる規律の共通実装）。React に依存しない
// 純粋なロジックであり、DOM を介さず検証できる。
//
// 🔴 disabled 属性は「表示」でしかない。連打やプログラム的な二重呼び出しでも
//    `task` が同時に 2 つ動かないことを保証するのはこのガードの役目である。
export type SubmitGuard<T> = {
  /** 現在、実行中の `task` があるか。 */
  readonly pending: boolean;
  /** 実行中に呼ばれた場合は `task` を呼ばずに `null` を返す（二重送信の抑止）。 */
  run(task: () => Promise<T>): Promise<T | null>;
};

export function createSubmitGuard<T>(): SubmitGuard<T> {
  let pending = false;
  return {
    get pending() {
      return pending;
    },
    async run(task) {
      if (pending) return null;
      pending = true;
      try {
        return await task();
      } finally {
        pending = false;
      }
    },
  };
}
