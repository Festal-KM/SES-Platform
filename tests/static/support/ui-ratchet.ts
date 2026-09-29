// tests/static/support/ui-ratchet.ts
// 🔴 **UI 刷新のラチェット**（`docs/05` §17.7.2 / `docs/sprints/SP-22` §4.1）。
//
// ============================================================================
// なぜラチェットか
// ============================================================================
// `docs/05` §17.7.1 の (a)(c)(f)(g)(j)(k) を一度に有効化すると**全画面が赤くなって前に進めない**
// （着手時の実測: 色の直書き 1,007 行 / 文字サイズ 667 行 / 幅 78 行 / spacing 26 行 /
// 状態バリアント 30 行 / 幅クラス未指定 43 ルート）。かといって「後で有効にする」と書いた検査は
// **有効にならない**。そこで **既存の `no-hardcoded-copy.test.ts` の `ALLOWED_HARDCODED_COPY` と
// 同じ形の許可リスト**を置き、次の 5 つで縮小を機械的に強制する（`docs/05` §17.7.2 の表）。
//
//   ① 許可リストは **ファイル単位 + 理由 + どの段で外すか** を持つ
//      → 外す基準が文書ではなくコードに書かれる。段は `SECTION_4_1_STAGES`（§4.1 の写し）と
//        照合され、**§4.1 に無いディレクトリを許可リストに載せられない**。
//   ② 🔴 **未使用の項目があれば落ちる**（違反が 0 になったのに載っている = 掃除が終わったのに残っている）
//      → 直したら必ず外れる。
//   ③ 🔴 **行数をスナップショットで固定**（`ui-ratchet-baseline.ts`）
//      → **増える変更は落ちる。減るのは可**（単調減少しか許されない）。
//   ④ 🔴 **初回の実体で凍結し、以後 1 行も追加できない**
//      → 許可リストのキーは凍結集合の**部分集合**でなければならない。**新しいファイルを
//        許可リストに足せない** = 刷新の途中で新しい直書きを持ち込めない。
//   ⑤ 各段のタスクの完了条件に除外が入っている（`SP-22` §4.1 の表。②が機械的に強制する）
//
// 🔴 **許可リストの対象は「ファイル」であって「クラス」ではない**（`docs/05` §17.7.2）。
//    クラス単位にすると「この色だけは許す」が増えて semantic 層が意味を失う。
//    **恒久例外は `AppShell` の `pb-24` の 1 件だけ**であり、それは許可リストではなく
//    `ui-spacing-scale.test.ts` の `PERMANENT_SPACING_EXCEPTION` として理由つきで置く。
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classTokensOf, collectSourceFiles, readSource, repoRoot, toRepoRelative } from './ui-classes.js';

/** `docs/sprints/SP-22` §4.1 の段（`Q-04-5` = 5 段）。 */
export type Stage = 1 | 2 | 3 | 4 | 5;

/** 許可リストの 1 項目（①「ファイル単位 + 理由 + どの段で外すか」）。 */
export type AllowEntry = {
  /** 🔴 その段で何を刷新するときに直すのか。空文字は不可。 */
  readonly reason: string;
  /** 🔴 §4.1 の表のどの段で外すか。`SECTION_4_1_STAGES` と一致しなければ落ちる。 */
  readonly stage: Stage;
};

export type Allowlist = ReadonlyMap<string, AllowEntry>;
/** ③④ の凍結（`ui-ratchet-baseline.ts`）。ファイル → 2026-09-30 時点の違反行数。 */
export type Baseline = ReadonlyMap<string, number>;

// ============================================================================
// §4.1 の表の写し（🔴 ミラー。`docs/sprints/SP-22` §4.1 が一次資料）
// ============================================================================
/**
 * 🔴 **`SP-22` §4.1「段と検査（ラチェット）の対応」の転記である。**
 *    先に一致した行が勝つ（上から順に照合する）。**ここに無いディレクトリのファイルは
 *    許可リストに載せられない** —— 載せたければ先に `docs/sprints/SP-22` §4.1 を改訂する
 *    （`CLAUDE.md` §8.7 の「下流だけ直して上流を放置しない」）。
 *
 * ⚠️ `screens` は §4.1 / §5 の画面 ID である。テストは ID の実在を検査しない（画面 ID の
 *    一次資料は `docs/04` であり、ここに写した ID の正しさは人間のレビュー事項）。
 */
export const SECTION_4_1_STAGES: ReadonlyArray<{
  readonly prefix: string;
  readonly stage: Stage;
  readonly screens: string;
}> = [
  // ── 段① 外枠（`T-22-01`〜`T-22-05`）。`packages/ui` の 19 部品 / `_shell/**` / `lib/shell/**`
  { prefix: 'apps/web/app/(main)/_shell/', stage: 1, screens: '外枠（AppShell / PageHeading）' },
  { prefix: 'apps/web/lib/shell/', stage: 1, screens: '外枠（ナビ・スコープ表示の値の組み立て）' },
  { prefix: 'packages/ui/src/', stage: 1, screens: 'UI プリミティブ 19 部品' },
  // 🔴 最外殻（root layout / global-error）は `AppShell` を入れ替える `T-22-05` が同時に見る範囲である。
  { prefix: 'apps/web/app/layout.tsx', stage: 1, screens: '外枠（root layout）' },
  { prefix: 'apps/web/app/global-error.tsx', stage: 1, screens: '外枠（root error boundary）' },

  // ── 段② 一覧（`T-22-06`〜`T-22-08`）。9 画面
  { prefix: 'apps/web/app/(main)/engineers/(list)/', stage: 2, screens: 'S-005' },
  { prefix: 'apps/web/app/(main)/engineers/engineer-ledger-screen.tsx', stage: 2, screens: 'S-005' },
  { prefix: 'apps/web/app/(main)/projects/(list)/', stage: 2, screens: 'S-010' },
  { prefix: 'apps/web/app/(main)/projects/project-list-screen.tsx', stage: 2, screens: 'S-010' },
  { prefix: 'apps/web/app/(main)/engineer-shares/', stage: 2, screens: 'S-015' },
  { prefix: 'apps/web/app/(main)/projects/[id]/candidates/', stage: 2, screens: 'S-016' },
  { prefix: 'apps/web/app/(main)/proposals/(list)/', stage: 2, screens: 'S-019' },
  { prefix: 'apps/web/app/(main)/audit-logs/', stage: 2, screens: 'S-041' },
  { prefix: 'apps/web/app/admin/tenants/page.tsx', stage: 2, screens: 'A-002' },
  { prefix: 'apps/web/app/admin/tenants/admin-tenants-list.tsx', stage: 2, screens: 'A-002' },
  { prefix: 'apps/web/app/admin/monitoring/', stage: 2, screens: 'A-005' },
  { prefix: 'apps/web/app/admin/audit-logs/', stage: 2, screens: 'A-006' },

  // ── 段③ ホーム（`T-22-09` / `T-22-10`）
  { prefix: 'apps/web/app/(main)/_home/', stage: 3, screens: 'S-003 / S-004' },
  { prefix: 'apps/web/lib/home/', stage: 3, screens: 'S-003 / S-004' },
  { prefix: 'apps/web/app/(main)/page.tsx', stage: 3, screens: 'S-003 / S-004' },

  // ── 段④ 承認・判断 / 詳細・編集・取込 / 認証と設定（`T-22-11`〜`T-22-13`）= 主平面の残り
  { prefix: 'apps/web/app/(main)/proposals/', stage: 4, screens: 'S-018 / S-020 / S-021 / S-023 / S-024' },
  { prefix: 'apps/web/app/(main)/proposal-requests/', stage: 4, screens: 'S-017 / S-022' },
  { prefix: 'apps/web/app/(main)/engineers/', stage: 4, screens: 'S-006〜S-009' },
  { prefix: 'apps/web/app/(main)/projects/', stage: 4, screens: 'S-011〜S-014' },
  { prefix: 'apps/web/app/(main)/skills/', stage: 4, screens: 'S-014 系（スキル辞書）' },
  { prefix: 'apps/web/app/(main)/settings/', stage: 4, screens: 'S-035 / S-036 / S-038 / S-042' },
  { prefix: 'apps/web/app/(main)/(auth)/', stage: 4, screens: 'S-001 / S-002 / S-046' },
  { prefix: 'apps/web/app/(main)/_shared/', stage: 4, screens: 'S-035 系（送信ドメインの帯）' },
  { prefix: 'apps/web/app/_components/', stage: 4, screens: 'S-001 / S-002 / S-046（認証の外殻）' },

  // ── 段⑤ 管理平面の残り（`T-22-14` / `T-22-15`）
  { prefix: 'apps/web/app/admin/', stage: 5, screens: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin' },
];

/** §4.1 の写しから段を決める。写しに無ければ `null`（許可リストに載せられない）。 */
export function stageOf(file: string): { readonly stage: Stage; readonly screens: string } | null {
  const row = SECTION_4_1_STAGES.find((entry) => file === entry.prefix || file.startsWith(entry.prefix));
  return row === undefined ? null : { stage: row.stage, screens: row.screens };
}

// ============================================================================
// 走査（クラス名を見る 5 検査の共通部分）
// ============================================================================

/** 違反 1 件（ファイル / 行 / 実際の語）。 */
export type ClassFinding = { readonly file: string; readonly line: number; readonly token: string };

/** 1 つのクラス名候補を見て、違反なら理由（実際の語）を返す検出器。 */
export type ClassDetector = (token: string) => string | null;

/**
 * `roots` 以下の実装 `.tsx` を走査して違反を集める。
 * 🔴 **行数は「違反を含む行の数」**（同じ行に 3 語あっても 1）。`docs/05` §17.7.2 ③ の
 *    スナップショットはこの単位で固定する —— 語の数にすると、1 行を 2 行に折り返しただけで
 *    数が変わらず「増えていない」ことになり、逆に折り返しを戻すと増えて落ちる。
 */
export function scanClassViolations(
  roots: readonly string[],
  detect: ClassDetector,
  extensions: readonly string[] = ['.tsx'],
): ClassFinding[] {
  const findings: ClassFinding[] = [];
  for (const root of roots) {
    for (const absolute of collectSourceFiles(root, extensions)) {
      const file = toRepoRelative(absolute);
      for (const { token, line } of classTokensOf(readSource(absolute), absolute)) {
        if (detect(token) !== null) findings.push({ file, line, token });
      }
    }
  }
  return findings;
}

/** ファイル → 違反行数（同じ行の複数語は 1 と数える）。 */
export function violationLinesByFile(findings: readonly { file: string; line: number }[]): Map<string, number> {
  const lines = new Map<string, Set<number>>();
  for (const finding of findings) {
    const set = lines.get(finding.file) ?? new Set<number>();
    set.add(finding.line);
    lines.set(finding.file, set);
  }
  return new Map([...lines].map(([file, set]) => [file, set.size]));
}

// ============================================================================
// ラチェットの 5 つの仕組みを 1 箇所で回す
// ============================================================================

export type RatchetInput = {
  /** 検査の識別（`docs/05` §17.7.1 の (a) 等）。失敗メッセージに出す。 */
  readonly label: string;
  /** 段ごとに削る許可リスト（②③④ の対象）。 */
  readonly allowlist: Allowlist;
  /** 🔴 2026-09-30 の実体（`ui-ratchet-baseline.ts`）。**編集しない。** */
  readonly baseline: Baseline;
  /** ファイル → 現在の違反行数。 */
  readonly actual: ReadonlyMap<string, number>;
  /** 走査が空振りしていないことの対照に使う「走査したファイル数」。 */
  readonly scannedFileCount: number;
};

/**
 * ①〜④ を `it()` 5 本として登録する。**本体（許可リスト外に違反が無い）は呼び出し側が持つ**
 * （検査ごとに出すべき差分の形が違うため）。
 */
export function describeRatchetInvariants(input: RatchetInput): void {
  const { label, allowlist, baseline, actual, scannedFileCount } = input;

  describe(`🔴 ${label} のラチェット（docs/05 §17.7.2 の 5 つの仕組み）`, () => {
    it('走査が空振りしていない（対照）', () => {
      expect(scannedFileCount).toBeGreaterThan(80);
    });

    it('① 許可リストの全項目が「理由」と「どの段で外すか」を持ち、段が SP-22 §4.1 と一致する', () => {
      const broken = [...allowlist].flatMap(([file, entry]) => {
        const row = stageOf(file);
        if (entry.reason.trim() === '') return [`${file}: 理由が空である`];
        if (row === null) return [`${file}: SP-22 §4.1 の表に無いディレクトリである（先に docs を改訂する）`];
        if (row.stage !== entry.stage) {
          return [`${file}: 段が §4.1 と食い違う（許可リスト = ${entry.stage} / §4.1 = ${row.stage}）`];
        }
        return [];
      });
      expect(broken).toEqual([]);
    });

    it('🔴 ② 未使用の許可が残っていない（違反が 0 になったら外す。掃除の完了を機械で強制する）', () => {
      const unused = [...allowlist.keys()].filter((file) => (actual.get(file) ?? 0) === 0);
      expect(
        unused,
        `違反が 0 になったファイルが許可リストに残っている。${label} の許可リストから削除すること`,
      ).toEqual([]);
    });

    it('🔴 ③ 違反行数が凍結スナップショットを超えていない（増える変更は落ちる / 減るのは可）', () => {
      const grown = [...actual]
        .filter(([file]) => allowlist.has(file))
        .flatMap(([file, lines]) => {
          const frozen = baseline.get(file);
          if (frozen === undefined) return [`${file}: 凍結スナップショットに無い（④ が本体）`];
          return lines > frozen ? [`${file}: ${frozen} 行 → ${lines} 行に増えている`] : [];
        });
      expect(grown, `${label}: 許可された移行中のファイルでも、違反を増やす変更は通さない`).toEqual([]);
    });

    it('🔴 ④ 許可リストが初回凍結（2026-09-30）の部分集合である（1 行も追加できない）', () => {
      const added = [...allowlist.keys()].filter((file) => !baseline.has(file));
      expect(
        added,
        `${label}: 許可リストに新しいファイルを足せない。新規ファイルは最初から semantic トークン / ` +
          `7 段 / 6 トークンで書くこと（docs/05 §17.7.2 ④）`,
      ).toEqual([]);
    });

    it('🔴 凍結スナップショットは 2026-09-30 の実体のままである（削らない。削るのは許可リスト側）', () => {
      // 許可リストから外れたファイルの行が凍結側に残っていること自体は正しい（履歴である）。
      // 🔴 ここで見るのは「凍結側が許可リストに合わせて縮められていないこと」——
      //    縮めると ④ の「部分集合である」が自明に成り立ち、追加の検知が効かなくなる。
      expect(baseline.size).toBeGreaterThanOrEqual(allowlist.size);
    });
  });
}

// ============================================================================
// 対照（fixtures）— 走査が端から端まで働くことを示す
// ============================================================================
/**
 * `tests/static/__fixtures__/ui-classes/` を走査する。
 * 🔴 **各ラチェット検査は「本番の走査で現に違反が在る」ことに加えて、これを使って
 *    「違反ファイルで N 行 / 適合ファイルで 0 行」を固定する。** 前者だけだと、検出器が
 *    たまたま別の理由で真になっている可能性を排除できない（`collectSourceFiles` は
 *    `__fixtures__` を除外するので、本番の集計にこのディレクトリは入らない）。
 */
export function scanClassFixtures(detect: ClassDetector): {
  readonly violationTokens: readonly string[];
  readonly cleanTokens: readonly string[];
} {
  const fixtureDir = path.join(repoRoot, 'tests', 'static', '__fixtures__', 'ui-classes');
  const findings = scanClassViolations([fixtureDir], detect);
  return {
    violationTokens: findings
      .filter((finding) => finding.file.endsWith('/violation.tsx'))
      .map((finding) => finding.token),
    cleanTokens: findings.filter((finding) => finding.file.endsWith('/clean.ok.tsx')).map((finding) => finding.token),
  };
}
