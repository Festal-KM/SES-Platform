// apps/web/lib/chat/project-card-text.ts
// ✅ 2026-10-23（チャットレーン・紺野）: 案件カードの表示の語と「条件を引用」の文面（純粋関数）。
//
// 🔴 `@ses/db` / `@ses/i18n` を値 import しない（会話の島が使う。`tests/static/client-db-boundary.test.ts`）。
//    語は `chat-props.ts` が `t()` で解決した束（`ChatProjectCardLabels`）を受け取る。
// 🔴 単価・エンド企業名を扱わない（カードの型にそもそも無い。`views.ts` の `ChatVisibleProjectCard`）。
import type { ChatProjectRequirementView, ChatVisibleProjectCard } from './views';

/** カードの語（`chat-props.ts` が解決して渡す）。 */
export type ChatProjectCardLabels = {
  /** 状態の語（`OPEN` / `CLOSED`）。 */
  readonly statuses: Readonly<Record<string, string>>;
  /** リモート可否の語（`RemoteMode`）。 */
  readonly remoteModes: Readonly<Record<string, string>>;
  /** 都道府県の語（コード → 名前）。 */
  readonly prefectures: Readonly<Record<string, string>>;
  /** 値が無いとき（`—`）。 */
  readonly none: string;
  /** 「年以上」。 */
  readonly yearsOrMore: string;
  /** 引用の見出し（「必須」「尚可」）。 */
  readonly must: string;
  readonly nice: string;
};

/** 要件 1 件の語（辞書名 → 自由記述の順。年数があれば「3 年以上」を添える）。案件一覧の `formatMustRequirement` と同じ形。 */
export function chatRequirementText(requirement: ChatProjectRequirementView, labels: ChatProjectCardLabels): string {
  const label = requirement.skillName ?? requirement.freeText ?? labels.none;
  if (requirement.requiredYears === null) return label;
  return `${label} ${String(requirement.requiredYears)} ${labels.yearsOrMore}`;
}

/** 勤務地 / リモート（「東京都・一部リモート」）。どちらも無ければ `—`。 */
export function chatProjectLocationText(project: ChatVisibleProjectCard, labels: ChatProjectCardLabels): string {
  const parts = [
    project.prefecture === null ? null : labels.prefectures[project.prefecture] ?? null,
    project.remoteMode === null ? null : labels.remoteModes[project.remoteMode] ?? null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? labels.none : parts.join('・');
}

/** 開始時期（`YYYY-MM-DD` をそのまま。無ければ `—`）。 */
export function chatProjectStartText(project: ChatVisibleProjectCard, labels: ChatProjectCardLabels): string {
  return project.startDate ?? labels.none;
}

/**
 * 「条件を引用」で入力欄に差し込む文面（Markdown の引用 `> `）。
 * 🔴 **要件だけ**を引く（案件名・単価・エンド企業名を入れない）。要件が 1 つも無ければ空文字（差し込まない）。
 */
export function chatProjectConditionsQuote(project: ChatVisibleProjectCard, labels: ChatProjectCardLabels): string {
  const lines: string[] = [];
  if (project.mustRequirements.length > 0) {
    lines.push(`> ${labels.must}: ${project.mustRequirements.map((entry) => chatRequirementText(entry, labels)).join('、')}`);
  }
  if (project.niceRequirements.length > 0) {
    lines.push(`> ${labels.nice}: ${project.niceRequirements.map((entry) => chatRequirementText(entry, labels)).join('、')}`);
  }
  return lines.join('\n');
}

/** 入力欄の今の文章に引用を足す（空なら引用だけ。続けて書けるよう引用の後ろに空行を置く）。 */
export function appendQuote(body: string, quote: string): string {
  if (quote === '') return body;
  const head = body.trimEnd();
  return `${head === '' ? '' : `${head}\n\n`}${quote}\n\n`;
}

/**
 * 「/」のメニューを出すか（入力欄の**行頭**で「/」を打ったとき）。
 * 返すのは、選んだときに取り除く範囲（行頭の「/」から入力位置まで）。出さないときは `null`。
 */
export function slashCommandRange(text: string, caret: number): { readonly start: number; readonly end: number } | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const token = text.slice(lineStart, caret);
  return /^\/[^\s/]*$/.test(token) ? { start: lineStart, end: caret } : null;
}

/** 案件詳細の行き先（ホストも取引先も同じ案件詳細の画面。取引先は自社に公開中の案件だけを開ける）。 */
export function chatProjectHref(projectId: string): string {
  return `/projects/${projectId}`;
}
