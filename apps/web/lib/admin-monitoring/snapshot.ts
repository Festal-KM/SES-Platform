// apps/web/lib/admin-monitoring/snapshot.ts
// 🔴 API-A8 の応答を**項目ごとに独立して**組み立てる（docs/05 §6.9 API-A8「項目ごとに独立して返す」/
//    docs/04 §A-005「項目ごとに独立して読み込み、揃うのを待たない」「項目単位のエラー」）。T-11-04。
//
// 材料の読み取り（`@ses/db/platform` / BullMQ / 送信基盤の口）は `apps/web/app/api/admin/monitoring/_lib/readers.ts`
// （管理平面ゾーン）が `MonitoringReaders` の形で渡す。ここは**読み取りの失敗を項目単位で `{ ok: false, errorKind }` に
// 落とし、順序を固定する**だけである。1 つの reader が throw しても他の項目は返る。
//
// 🔴 `{ ok: false }` は「取得できませんでした」であり「0 件」ではない。0 件で埋めると「監視が動いていない」と
//    「異常が無い」を区別できなくなる（docs/04 §A-005 空状態の 🔴）。
import {
  MONITORING_KINDS,
  type MonitoringErrorKind,
  type MonitoringItemView,
  type MonitoringKind,
  type MonitoringPayloadByKind,
  type MonitoringSnapshotView,
} from './view';

/** 項目 1 つの読み取り口。`errorKind` は失敗したときに応答へ載せる種別（内容ではなく出所）。 */
export type MonitoringReader<K extends MonitoringKind> = {
  readonly errorKind: MonitoringErrorKind;
  readonly read: () => Promise<MonitoringPayloadByKind[K]>;
};

export type MonitoringReaders = { readonly [K in MonitoringKind]: MonitoringReader<K> };

/**
 * 読み取りの失敗を**記録する**口（Sentry / 構造化ログ。docs/05 §16.3「Sentry と併用する」）。
 * 🔴 応答には種別しか載せないが、原因はここへ流す（握り潰さない）。
 */
export type MonitoringFailureSink = (kind: MonitoringKind, errorKind: MonitoringErrorKind, error: unknown) => void;

async function readOne<K extends MonitoringKind>(
  kind: K,
  reader: MonitoringReader<K>,
  onFailure: MonitoringFailureSink,
): Promise<MonitoringItemView<K>> {
  try {
    const payload = await reader.read();
    return { kind, ok: true, ...payload } as MonitoringItemView<K>;
  } catch (error) {
    onFailure(kind, reader.errorKind, error);
    return { kind, ok: false, errorKind: reader.errorKind };
  }
}

/**
 * 🔴 全項目を並列に読み、`MONITORING_KINDS` の順で返す。1 項目の失敗は他を巻き込まない。
 */
export async function buildMonitoringSnapshot(
  readers: MonitoringReaders,
  now: Date,
  onFailure: MonitoringFailureSink,
): Promise<MonitoringSnapshotView> {
  const items = await Promise.all(
    MONITORING_KINDS.map((kind) => readOne(kind, readers[kind] as MonitoringReader<MonitoringKind>, onFailure)),
  );
  return { observedAt: now.toISOString(), items };
}
