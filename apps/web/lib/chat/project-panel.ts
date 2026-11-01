// apps/web/lib/chat/project-panel.ts
// ✅ 2026-10-29（紺野の決定）: 案件カードの「案件詳細を開く」で、チャットを離れずに開く欄の中身（純粋関数）。
//
// 🔴 ここが守るもの
//   ① 読むのは既存の案件詳細の API（`GET /api/projects/{id}`。`docs/05` §6.4 #27）だけ。閲覧の監査・公開範囲の判定
//      （ホストは自社の案件、取引先は自社に公開中の案件だけ）はそこが行う。新しい読み取りの経路を作らない。
//   ② 欄に出すのは**ホストにも取引先にも出してよい共通の項目のうち、カードと同じ考え方の項目だけ**
//      （案件名・状態・開始・勤務地 / リモート・募集人数・必須 / 尚可の要件・外部公開用の概要）。
//      🔴 エンド企業名・自社単価・公開先（ホストだけの項目）と単価レンジは、応答にあっても拾わない（`pickChatProjectPanelDetail`）。
//      チャットの画面は取引先と同じ部屋を見ながら使うため、カードと同じく単価・商流を出さない。全項目は「案件のページで開く」で見る。
//   ③ React・`@ses/i18n` に依存しない（会話の島から使う）。
import { chatProjectLocationText, chatRequirementText, type ChatProjectCardLabels } from './project-card-text';
import type { ChatProjectRequirementView } from './views';

/** 案件詳細の API（#27。既存の読み取りの経路）。🔴 画面に URL を書き写さない。 */
export function chatProjectDetailApiPath(projectId: string): string {
  return `/api/projects/${projectId}`;
}

export type ChatProjectPanelDetail = {
  readonly name: string;
  readonly status: string;
  readonly headcount: number | null;
  readonly startDate: string | null;
  readonly prefecture: string | null;
  readonly remoteMode: string | null;
  readonly publicSummary: string | null;
  readonly must: readonly ChatProjectRequirementView[];
  readonly nice: readonly ChatProjectRequirementView[];
};

export type ChatProjectPanelLabels = ChatProjectCardLabels & {
  readonly status: string;
  readonly start: string;
  readonly location: string;
  readonly headcount: string;
  readonly headcountUnit: string;
  readonly summary: string;
};

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function requirementOf(value: unknown): (ChatProjectRequirementView & { readonly kind: string }) | null {
  if (typeof value !== 'object' || value === null) return null;
  const entry = value as Record<string, unknown>;
  return {
    kind: stringOrNull(entry['kind']) ?? '',
    skillName: stringOrNull(entry['skillName']),
    freeText: stringOrNull(entry['freeText']),
    requiredYears: typeof entry['requiredYears'] === 'number' ? entry['requiredYears'] : null,
  };
}

/** 案件詳細の応答から、欄に出す項目だけを拾う（🔴 ② 商流・単価・公開先は拾わない）。形が違えば `null`。 */
export function pickChatProjectPanelDetail(body: unknown): ChatProjectPanelDetail | null {
  if (typeof body !== 'object' || body === null) return null;
  const view = body as Record<string, unknown>;
  const name = stringOrNull(view['name']);
  if (name === null) return null;
  const requirements = (Array.isArray(view['requirements']) ? view['requirements'] : [])
    .map(requirementOf)
    .filter((entry): entry is NonNullable<ReturnType<typeof requirementOf>> => entry !== null);
  const plain = ({ kind, ...rest }: ChatProjectRequirementView & { readonly kind: string }): ChatProjectRequirementView => {
    void kind;
    return rest;
  };
  return {
    name,
    status: stringOrNull(view['status']) ?? '',
    headcount: typeof view['headcount'] === 'number' ? view['headcount'] : null,
    startDate: stringOrNull(view['startDate']),
    prefecture: stringOrNull(view['prefecture']),
    remoteMode: stringOrNull(view['remoteMode']),
    publicSummary: stringOrNull(view['publicSummary']),
    must: requirements.filter((entry) => entry.kind === 'MUST').map(plain),
    nice: requirements.filter((entry) => entry.kind === 'NICE').map(plain),
  };
}

/** 欄の項目（見出しと値の組。`Drawer` の `items`）。値が無い項目は `—`。 */
export function chatProjectPanelItems(
  detail: ChatProjectPanelDetail,
  labels: ChatProjectPanelLabels,
): readonly { readonly label: string; readonly value: string }[] {
  const list = (entries: readonly ChatProjectRequirementView[]) =>
    entries.length === 0 ? labels.none : entries.map((entry) => chatRequirementText(entry, labels)).join('、');
  return [
    { label: labels.status, value: labels.statuses[detail.status] ?? labels.none },
    { label: labels.start, value: detail.startDate ?? labels.none },
    { label: labels.location, value: chatProjectLocationText(detail, labels) },
    { label: labels.headcount, value: detail.headcount === null ? labels.none : `${String(detail.headcount)}${labels.headcountUnit}` },
    { label: labels.must, value: list(detail.must) },
    { label: labels.nice, value: list(detail.nice) },
    { label: labels.summary, value: detail.publicSummary === null || detail.publicSummary.trim() === '' ? labels.none : detail.publicSummary },
  ];
}
