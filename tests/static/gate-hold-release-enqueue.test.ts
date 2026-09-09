// tests/static/gate-hold-release-enqueue.test.ts
// 🔴 docs/05 §17.2 #19: **`gate.hold-release` が `gate.run` 以外を enqueue しない**
//    （送信系の再 enqueue に転用されていないこと）。T-07-10。
//
// ============================================================================
// 🔴 なぜ静的テストが要るか
// ============================================================================
// このジョブは「保留を自動で再試行してよい唯一の経路」である（`attempts: 3`）。§10 が禁じている
// **外部送信の自動リトライ**を、ここに 1 行足すだけで実現できてしまう位置にある
// （`send.proposal` を積めば、承認済みの提案が 10 分ごとに自動再送される = `BR-21` / `BR-22` 違反）。
// 実行時テストは「今その分岐を通る入力」でしか確かめられないので、**構造として**塞ぐ。
//
// 併せて次の 3 つも固定する（いずれも実行時には気づきにくい形で壊れる）:
//   ② 🔴 保留行を**先に `DONE` にしない**（docs/05 §11.9 ⑧-7）。完了 CAS が多重化防止の
//      最後の防波堤であり、ここで先に確定させると #39 の手動再実行と競合したときに
//      「結果が 2 行・遷移が 2 回」が成立する。
//   ③ 🔴 案件の**公開要求に触らない**（docs/05 §11.11 ⑪-1）。復帰後の実行が公開先を復元できる
//      前提そのものであり、ここで消費すると「上限で保留された公開だけが誰にも公開されない」。
//   ④ 🔴 **失敗した `gate.run` の記録を消さない**（docs/05 §11.12 ⑦-2 の 🔴 / §9.10 ①）。
//      1 行 `removeFailedJob` を足すだけで**自動リトライそのもの**になり、失敗が §16.5 の
//      失敗ジョブ数から消えて「壊れているのに誰も気づかない」状態になる。自動経路は
//      「積めなかった」ことを数えて返すだけであり、復帰の入口は利用者の #39 だけである。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_SEND_JOB_NAMES,
  INTERNAL_JOB_NAMES,
} from '../../packages/connectors/src/queues.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const JOB_FILE = path.join(repoRoot, 'apps', 'worker', 'src', 'jobs', 'gate-hold-release.ts');

/** 🔴 このジョブが名乗ってよい唯一のキュー名（自分自身）。 */
const OWN_JOB_NAME = 'gate.hold-release';
/** 🔴 積んでよい唯一の宛先。 */
const ALLOWED_ENQUEUE_TARGET = 'gate.run';

/**
 * 🔴 **このジョブが呼んではならない関数**。
 *
 * 前半 5 つは `packages/db` の書き込み関数である。列挙で足りるのは、ゲートの状態を動かせる関数が
 * この 5 つしか無いからである（`packages/db` の外から `review_gates` / `project_visibilities` を
 * 書く経路は存在しない）。
 *
 * 🔴 最後の `removeFailedJob` は**キューの失敗記録の削除**（`GateRunQueue` のメソッド）である。
 *    出所は違うが、禁じる理由は同じ「1 行で自動リトライになる」であり、しかもこちらは
 *    **§16.5 の失敗ジョブ数から失敗を消す**ぶん気づきにくい（docs/05 §11.12 ⑦-2 の 🔴）。
 *    消してよいのは利用者の明示操作（#39 / #28）だけである。
 */
const FORBIDDEN_CALLEES = [
  'completeReviewGate',
  'holdReviewGate',
  'settleProjectPublish',
  'withdrawProjectPublishRequest',
  'reserveAiCost',
  'removeFailedJob',
] as const;

const source = ts.createSourceFile(
  JOB_FILE,
  readFileSync(JOB_FILE, 'utf8'),
  ts.ScriptTarget.ES2023,
  true,
  ts.ScriptKind.TS,
);

function collect<T extends ts.Node>(predicate: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  const visit = (node: ts.Node): void => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * 🔴 **AST 上の文字列リテラル**だけを見る（素のテキストだと、このファイルの説明コメントに
 *    書かれたジョブ名で必ず誤検知する）。
 */
function stringLiterals(): string[] {
  return collect((node): node is ts.StringLiteralLike => ts.isStringLiteralLike(node)).map(
    (node) => node.text,
  );
}

/** 呼び出されている関数名（`foo(...)` と `ns.foo(...)` の両形）。 */
function calleeNames(): Set<string> {
  const names = new Set<string>();
  for (const call of collect(ts.isCallExpression)) {
    const callee = call.expression;
    if (ts.isIdentifier(callee)) names.add(callee.text);
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
      names.add(callee.name.text);
    }
  }
  return names;
}

/** `import ... from '...'` の module specifier → 取り込んだ名前。 */
function importedNames(moduleSpecifier: string): string[] {
  const names: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== moduleSpecifier) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) names.push(element.name.text);
    }
  }
  return names;
}

describe('🔴 gate.hold-release が積める先は gate.run だけ（docs/05 §17.2 #19）', () => {
  const literals = stringLiterals();
  const knownQueueNames = new Set<string>([...EXTERNAL_SEND_JOB_NAMES, ...INTERNAL_JOB_NAMES]);

  it('対照: 検査が空振りしていない（自分のキュー名がソースに現れる）', () => {
    expect(literals).toContain(OWN_JOB_NAME);
    expect(knownQueueNames.has(ALLOWED_ENQUEUE_TARGET)).toBe(true);
  });

  it('🔴 ソースに現れるキュー名は自分自身だけ（`send.*` / `email.*` を名乗れない）', () => {
    const mentioned = [...new Set(literals.filter((value) => knownQueueNames.has(value)))].sort();
    // 🔴 `gate.run` は**識別子**（`GateRunJob` の型と enqueue 側の 1 実装）経由でしか触らない ——
    //    名前の文字列をここに書くと、`jobId` の組み立てが 2 箇所に散る入口になる。
    expect(mentioned).toEqual([OWN_JOB_NAME]);
  });

  it('🔴 enqueue の口は 1 つで、その型は GateRunJob である', () => {
    const properties = collect(ts.isPropertySignature).filter(
      (node) => ts.isIdentifier(node.name) && /enqueue/i.test(node.name.text),
    );
    expect(properties).toHaveLength(1);
    const property = properties[0];
    const name = property?.name;
    expect(name !== undefined && ts.isIdentifier(name) ? name.text : null).toBe('enqueueGateRun');
    // 型注記に現れる job の型は `GateRunJob` だけ（`OperationalMailDispatch` などは現れない）。
    expect(property?.type?.getText(source)).toContain('GateRunJob');
  });

  it('🔴 呼び出している enqueue 系は enqueueGateRun だけ', () => {
    const enqueues = [...calleeNames()].filter((name) => /enqueue/i.test(name));
    expect(enqueues).toEqual(['enqueueGateRun']);
  });

  it('🔴 @ses/connectors から取り込むのは gate.run の契約だけ（送信系の名前を持ち込まない）', () => {
    const imported = importedNames('@ses/connectors').sort();
    // 🔴 スナップショットである。名前が増えたら**それが `gate.run` の契約か**を人間が確かめる
    //    （`GateRunEnqueueOutcome` は「積めたか」の戻り値。T-07-10 の是正で追加した）。
    expect(imported).toEqual(['GateRunEnqueueOutcome', 'GateRunJob', 'InternalJobName']);
  });
});

describe('🔴 保留行・公開要求・失敗記録に触らない（docs/05 §11.9 ⑧-7 / §11.11 ⑪-1 / §11.12 ⑦-2）', () => {
  const callees = calleeNames();

  it('対照: 読み取りの 2 関数は呼んでいる（検査が空振りしていない）', () => {
    expect(callees.has('listPendingReviewGates')).toBe(true);
    expect(callees.has('probeAiCostHeadroom')).toBe(true);
  });

  it.each(FORBIDDEN_CALLEES)('🔴 %s を呼ばない', (name) => {
    expect(callees.has(name)).toBe(false);
  });

  it('🔴 @ses/db から取り込むのは読み取り 2 関数と ctx の組み立てだけ', () => {
    expect(importedNames('@ses/db').sort()).toEqual([
      'listPendingReviewGates',
      'probeAiCostHeadroom',
      'systemTenantCtx',
    ]);
  });
});
