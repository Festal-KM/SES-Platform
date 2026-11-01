// apps/web/app/(main)/projects/_search/saved-searches.ts
// `S-010` の「保存した条件」の置き場所（改修指示書 §5）。
//
// ============================================================================
// 🔴🔴 **これは「このブラウザーに保存」である。サーバには 1 バイトも行かない。**
// ============================================================================
// 指示書 §5: 「既存の保存 API・認証・ユーザー別設定がある場合は、そちらに接続してください。
//             保存機能が未実装なら、今回の最小実装としてブラウザー保存にして構いません。
//             その場合は『このブラウザーに保存』と明示し、**会社 ID・ユーザー ID・画面 ID・
//             形式バージョン**で保存先を区別してください。」
//
// 🔴 **既存の保存 API は無い**（`apps/web/app/api/**` に検索条件の保存は 1 本も無く、
//    `packages/db/prisma/schema.prisma` にも該当する表が無い。`HANDOFF.md` の残件
//    「#6 検索条件の保存」が未着手である）。したがって**ブラウザー保存**を採る。
// 🔴 **画面にも「このブラウザーに保存」と出す**（`saved-search-list.tsx`）——
//    サーバ保存が完成したかのような UI にしない（指示書 §5）。
// 🔴 **他端末と同期されない。** 将来サーバ保存（`#6`）が入ったら、この層を差し替える。
//
// ============================================================================
// 🔴 保存先の鍵（指示書 §5 の 4 つをすべて入れる）
// ============================================================================
//   ses.projects.savedSearches.v1.<tenantId>.<userId>
//   └─ 画面 ID ──┘              └ 形式 ┘  └─ 会社 ID ─┘ └ ユーザー ID ┘
//
// 🔴 **ユーザーをまたぐ共通保存にしない** —— 同じ端末を複数人が使う運用（営業の共用 PC）で、
//    他人の条件が見えると「誰の条件か分からない保存」が生まれる。人間の既決事項
//    （2026-10-18 の `検索条件の保存は「保存した本人だけ」`）とも一致する。
// 🔴 **検索結果そのもの・選択案件 ID・開閉状態は混ぜない**（指示書 §5）。

import {
  parseSavedProjectSearchDraft,
  type ProjectSearchDraft,
} from './filters';

/** 形式のバージョン。🔴 **上げたら古い鍵は読まない**（黙って壊れた形を読まない）。 */
const STORAGE_FORMAT_VERSION = 'v1';

/** 画面 ID（`docs/04` の `S-010`）。 */
const SCREEN_ID = 'projects';

/** 🔴 1 ユーザーあたりの上限（器が無制限に育たないようにする）。 */
export const SAVED_SEARCH_MAX = 30;

/** 保存名の長さ（指示書 §5「前後の空白を除いて 1〜40 文字」）。 */
export const SAVED_SEARCH_NAME_MIN = 1;
export const SAVED_SEARCH_NAME_MAX = 40;

export type SavedSearch = {
  readonly id: string;
  readonly name: string;
  readonly filters: ProjectSearchDraft;
  /** ISO8601。🔴 並びを決めるためだけに持つ（画面には出さない）。 */
  readonly updatedAt: string;
  readonly lastUsedAt?: string;
};

export type SavedSearchStore = {
  readonly items: readonly SavedSearch[];
  /**
   * 🔴 **読めなかったことを隠さない**（指示書 §5「破損データ、旧形式、保存容量エラーを扱い、
   *    失敗しているのに『保存しました』と表示しないでください」）。
   */
  readonly broken: boolean;
};

export const EMPTY_SAVED_SEARCH_STORE: SavedSearchStore = { items: [], broken: false };

/** 🔴 **会社 ID と ユーザー ID をここで 1 本の鍵にする**（呼び出し側で組み立てさせない）。 */
export function savedSearchStorageKey(tenantId: string, userId: string): string {
  return `ses.${SCREEN_ID}.savedSearches.${STORAGE_FORMAT_VERSION}.${tenantId}.${userId}`;
}

/**
 * ✅✅ **折りたたみの状態を覚える cookie の名**（**ユーザー単位**。指示書 §4）。
 *
 * 🔴🔴 **`localStorage` ではなく cookie で持つ理由**: サーバが**最初からその状態で描ける**。
 *    `localStorage` は水合の後にしか読めないので、「開いてから閉じる」ちらつきが必ず出る。
 * 🔴 **このファイルに置く理由**: `'use client'` を宣言していないので、
 *    **サーバ（`page.tsx`）からも呼べる**。島の中に置くと
 *    「client の関数を server から呼んだ」で落ちる（実測で踏んだ）。
 * ⚠️ cookie はブラウザープロファイル単位であるが、**名前にユーザー ID を入れている**ので
 *    同じ端末を複数人が使っても混ざらない。
 */
export function searchExpandedCookieName(userId: string): string {
  return `ses.${SCREEN_ID}.search.expanded.${userId}`;
}

/**
 * 🔴 **`localStorage` に触る唯一の場所**（この 2 関数の外から触らない）。
 * 🔴 **例外を投げない** —— プライベートウィンドウ・サイトデータの遮断で
 *    アクセス自体が throw することがある（その場合は「保存できない」として扱う）。
 */
function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    // 🔴 容量超過（`QuotaExceededError`）もここに来る。**成功したことにしない。**
    return false;
  }
}

/**
 * 保存されている条件を読む。
 *
 * 🔴 **壊れていたら空 + `broken: true`** —— 黙って捨てると「保存したはずのものが消えた」の
 *    理由が画面から読めない。
 */
export function readSavedSearches(key: string): SavedSearchStore {
  const raw = readRaw(key);
  if (raw === null) return EMPTY_SAVED_SEARCH_STORE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { items: [], broken: true };
  }
  if (typeof parsed !== 'object' || parsed === null) return { items: [], broken: true };
  const record = parsed as Record<string, unknown>;
  // 🔴 **旧形式は読まない**（鍵にバージョンが入っているので本来は届かないが、二重の壁）。
  if (record.version !== 1) return { items: [], broken: true };
  if (!Array.isArray(record.items)) return { items: [], broken: true };
  const items: SavedSearch[] = [];
  for (const entry of record.items) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const filters = parseSavedProjectSearchDraft(row.filters);
    if (typeof row.id !== 'string' || typeof row.name !== 'string' || filters === null) continue;
    items.push({
      id: row.id,
      name: row.name,
      filters,
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
      ...(typeof row.lastUsedAt === 'string' ? { lastUsedAt: row.lastUsedAt } : {}),
    });
  }
  return { items, broken: false };
}

/** 書き込み。🔴 **失敗を `false` で返す**（呼び出し側が「保存しました」を出さない根拠）。 */
export function writeSavedSearches(key: string, items: readonly SavedSearch[]): boolean {
  return writeRaw(key, JSON.stringify({ version: 1, items }));
}

/** 🔴 保存名は**前後の空白を除いて** 1〜40 文字（指示書 §5）。 */
export function isValidSavedSearchName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= SAVED_SEARCH_NAME_MIN && trimmed.length <= SAVED_SEARCH_NAME_MAX;
}

/**
 * 🔴 **ID は衝突しなければよい**（外部に出ない値であり、推測可能性に意味が無い）。
 * ⚠️ `crypto.randomUUID` はセキュアコンテキストでのみ使えるため、無いときは時刻 + 乱数に落ちる。
 */
export function newSavedSearchId(): string {
  const api = globalThis.crypto as Crypto | undefined;
  if (api !== undefined && typeof api.randomUUID === 'function') return api.randomUUID();
  return `s-${String(Date.now())}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 適用元の選択はタブ単位で保持する。未記録と明示クリア(null)を区別する。 */
export function readSavedSearchSelection(key: string): string | null | undefined {
  try {
    const raw = window.sessionStorage.getItem(`${key}.selection`);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return parsed === null || typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function writeSavedSearchSelection(key: string, id: string | null): void {
  try {
    window.sessionStorage.setItem(`${key}.selection`, JSON.stringify(id));
  } catch {
    // 保存が遮断された場合も、その場での選択と検索は継続する。
  }
}
