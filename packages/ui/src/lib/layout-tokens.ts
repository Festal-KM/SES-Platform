// packages/ui/src/lib/layout-tokens.ts
// 🔴 **外枠の寸法の唯一の出所**（`docs/design-system.md` §2 / §4。人間のデザインシステム定義 v1.0）。
//
// ============================================================================
// なぜこのファイルが要るのか
// ============================================================================
// **同じ外枠が画面ごとに少しずつ違う、という壊れ方を防ぐため。** サイドバーがホームでは 208px、
// 人材管理では 220px、案件管理では 240px —— これは 1 画面ずつ見ても気づけず、画面を行き来して
// 初めて「何かずれている」と分かる。原因は担当者の注意力ではなく、**寸法を画面側で決めている
// こと**である。
//
// 🔴 **画面側はこの定数（またはそれを埋め込んだ部品）を使うだけで、px を書き直さない。**
//    機械検査は `tests/static/layout-tokens.test.ts`（同じ px のクラスがこのファイルの外に
//    生えていないこと）。
//
// 🔴 **px と Tailwind のクラスを対で持つ。** px だけだと `w-[208px]` のような任意値が生え
//    （`tests/static/ui-shadow-and-size.test.ts` が落とす）、クラスだけだと「それが何 px か」を
//    レイアウトの計算（`pageBodySplitGeometry`）から参照できない。
//
// 🔴 **Tailwind の spacing は 1 単位 = 4px である。** `w-52` = 208px / `w-97` = 388px /
//    `h-11.5` = 46px。小数の段（`11.5`）は Tailwind v4 が基底の倍率から `calc()` で生成する。

/** サイドバー（展開時）。🔴 デザインシステム v1.0 §2。 */
export const SIDEBAR_WIDTH_PX = 208;
export const SIDEBAR_WIDTH_CLASS = 'w-52';

/** サイドバー（アイコンのみ）。`xl` 未満の既定（`docs/04` §3.1 の 2 形態）。 */
export const SIDEBAR_RAIL_WIDTH_PX = 56;
export const SIDEBAR_RAIL_WIDTH_CLASS = 'w-14';

/** サイドバーのナビ 1 項目。**184 × 46**（左右 margin 12 + 内側 padding 16 = 28）。 */
export const SIDEBAR_NAV_ITEM_HEIGHT_PX = 46;
export const SIDEBAR_NAV_ITEM_HEIGHT_CLASS = 'h-11.5';

/**
 * 🔴 **環境バナーが画面上端で占める高さ**（`md` 以上。✅ 2026-10-13）。
 *
 * 🔴 **なぜ寸法が要るのか**: バナーは `sticky top-0` で**常に viewport の上端に居座る**。
 *    一方サイドバーは `sticky top-0 h-dvh` なので、バナーがあると
 *    **柱が viewport より 40px 長くなり、最下部（本人の箱）がはみ出して切れる**
 *    （実測: 1672 × 941 で下 19px が欠けた）。柱の高さから**この値を引く**必要がある。
 * 🔴 **バナーの高さを `md` 以上で固定する理由**: 可変（文言の折り返し）だと引く値が決まらない。
 *    `md` 未満にサイドバーは存在しない（ボトムタブに置き換わる）ので、**狭い画面では
 *    従来どおり折り返してよい**。
 * ⚠️ 引き算の経路は **CSS 変数 `--app-banner-h`**（`apps/web/app/layout.tsx` が `<body>` に
 *    置き、`production` では置かない = 既定の `0px`）。props で配らないのは、
 *    **バナーの有無がレイアウトの実行時の値**であり、部品の木の 3 階層を貫通させると
 *    「渡し忘れた枝だけ 40px ずれる」が起きるためである。
 */
export const ENV_BANNER_HEIGHT_PX = 40;
export const ENV_BANNER_HEIGHT_CLASS = 'md:h-10';
/** 🔴 `<body>` に置く CSS 変数の名前（置く側と引く側で 1 文字も違ってはならない）。 */
export const ENV_BANNER_HEIGHT_VAR = '--app-banner-h';

/** Top Header。🔴 全画面で同じ高さ。 */
export const HEADER_HEIGHT_PX = 56;
export const HEADER_HEIGHT_CLASS = 'h-14';

/** Top Header のグローバル検索。基準幅（1672）で 726px。狭い画面では縮む。 */
export const HEADER_SEARCH_MAX_WIDTH_CLASS = 'max-w-181.5';

/**
 * 本文の左右 gutter。🔴 **左 28 / 右 16 の非対称である**（デザインシステム v1.0 §2）——
 * 右には副カラムが来るため、右端の余白は副カラム自身の内側 padding（16）と二重に見える。
 */
export const CONTENT_PADDING_LEFT_PX = 28;
export const CONTENT_PADDING_RIGHT_PX = 16;
export const CONTENT_PADDING_X_CLASSES = 'pl-7 pr-4';

/** 本文の上下。 */
export const CONTENT_PADDING_Y_PX = 20;
export const CONTENT_PADDING_Y_CLASS = 'py-5';

/** 右の副カラム（レール）。🔴 **固定幅**。450px 以上にしない。 */
export const RAIL_WIDTH_PX = 388;
export const RAIL_WIDTH_CLASS = 'w-97';

/** 本体カラムと副カラムの間。 */
export const COLUMN_GAP_PX = 16;
export const COLUMN_GAP_CLASS = 'gap-4';

/** セクション Card の間（本体カラム）。 */
export const SECTION_GAP_PX = 12;
export const SECTION_GAP_CLASS = 'gap-3';

/** 一覧の行（Section Card の中）。 */
export const ROW_HEIGHT_PX = 45;
export const ROW_HEIGHT_CLASS = 'min-h-11.25';

/** セクションの見出しの帯。 */
export const SECTION_HEADER_HEIGHT_PX = 40;
export const SECTION_HEADER_HEIGHT_CLASS = 'min-h-10';

/** タブの帯（白い面の中に項目が並ぶ）。 */
export const TAB_BAR_HEIGHT_PX = 40;
export const TAB_BAR_HEIGHT_CLASS = 'min-h-10';

/** KPI カード。 */
export const KPI_CARD_HEIGHT_PX = 105;
export const KPI_CARD_HEIGHT_CLASS = 'min-h-26.25';
export const KPI_ICON_TILE_PX = 48;
export const KPI_ICON_TILE_CLASSES = 'h-12 w-12';

/** 画面タイトルのブロック（h1 + 日付 + メッセージ）。 */
export const TITLE_BLOCK_MIN_HEIGHT_CLASS = 'min-h-16';

/**
 * 一覧の行の列幅（🔴 **全画面で同じ**。デザインシステム v1.0 §3.6）。
 *
 * 🔴 **先頭のチェックボックス列（16 + gap 28）は描いていない** —— `Task` の API が実装側に
 *    無く、押して何も起きない操作を置かないため（`docs/design-system.md` §6 ⑦ / Issue #90）。
 *    **列ごと詰める**（空の列を空けておくと、再開したときに幅を測り直すことになる）。
 */
export const ROW_META_WIDTH_CLASS = 'w-30';
// 🔴 ✅ 2026-10-13 の実測で 240 → **280** にした。1672px の実機で 種別 + 優先度 + 状態 の 3 つが
//    1 行に収まらず、**行が 45 → 55px に伸びていた**（`docs/design-system.md` §6 ⑥）。
// 🔴 ✅ 実機の実測で 240 → 280 → **304** と広げた。2026-10-13 の 2 回目の実測で、
//    `面談調整中` の行（種別 96 + 優先度 74 + 状態 124 + 余白 8 = 302）がまだ 2 行に折り返し、
//    行が 45 → 55px になっていた。🔴 **仕様書の 180 から広げている理由**は
//    `docs/design-system.md` §6 ⑥（モックは 1 行に 1 つ、本実装は 2〜3 つ）。
export const ROW_BADGE_WIDTH_CLASS = 'w-76';
export const ROW_ACTION_WIDTH_CLASS = 'w-36.5';
export const ROW_ACTION_HEIGHT_CLASS = 'h-8';

/**
 * チャット（`S-031`。`docs/design-system.md` §4.5）。
 * 🔴 Main 1018 = スレッド一覧 **320** + 会話 698。Right 388 は共通の副カラムと同じ。
 */
export const CHAT_THREAD_LIST_WIDTH_PX = 320;
export const CHAT_THREAD_LIST_WIDTH_CLASS = 'w-80';
/** スレッド一覧の 1 行（60）。 */
export const CHAT_THREAD_ROW_HEIGHT_CLASS = 'min-h-15';
/** 会話のコンポーザー（64）。 */
export const CHAT_COMPOSER_HEIGHT_CLASS = 'min-h-16';
/**
 * ✅ 2026-10-22（紺野「全部スクロールじゃなくて、ウィンドウ内だけスクロールできるように」）: チャット画面の本文の高さ（`md` 以上）。
 * 画面の高さ − 環境バナー − Top Header（56）。この中で一覧・会話・左の列が**それぞれの枠の中だけで**スクロールする。
 * 🔴 `md` 未満は従来どおり画面ごとスクロールする（入力欄は下に貼り付く）。
 * 🔴 引き算はサイドバーと同じ CSS 変数 `--app-banner-h`（`production` では既定の `0px`）。
 */
export const CHAT_SCREEN_HEIGHT_CLASS = 'md:h-[calc(100dvh-var(--app-banner-h,0px)-3.5rem)]';
/**
 * メッセージのバブルの上限幅（560）。
 * 🔴 **`packages/ui` に置く** —— `max-w-*` は画面側に書けない（`tests/static/ui-screen-width.test.ts`）。
 *    幅の上限は「読める行長」の規約であり、画面ごとに決め直すものではない。
 */
export const CHAT_BUBBLE_MAX_WIDTH_CLASS = 'max-w-140';
/** 右の関連情報パネルの Key-Value 行（30）とキーの列（124）。 */
export const PANEL_KV_ROW_HEIGHT_CLASS = 'min-h-7.5';
export const PANEL_KEY_WIDTH_CLASS = 'w-31';

/** 右レールの行（スケジュール / 優先アクション）。 */
export const RAIL_SCHEDULE_ROW_HEIGHT_CLASS = 'min-h-14.5';
export const RAIL_PRIORITY_ROW_HEIGHT_CLASS = 'min-h-12.5';
export const RAIL_RANK_CIRCLE_CLASSES = 'h-7 w-7';

/**
 * 一覧に常設する詳細ペイン。デスクトップは検索の上端から画面下の余白までを使う。
 * 11rem = header 56px + 本文上余白24px + ページ見出し72px + 下余白24px。
 * 環境バナーの有無は共通の CSS 変数で引く。モバイルは自然な文書フローに戻す。
 */
export const DETAIL_PANE_VIEWPORT_CLASSES =
  'lg:sticky lg:top-[calc(var(--app-banner-h,0px)+4.5rem)] lg:h-[calc(100dvh-var(--app-banner-h,0px)-11rem)] lg:min-h-80';
