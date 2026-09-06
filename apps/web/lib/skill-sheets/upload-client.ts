// apps/web/lib/skill-sheets/upload-client.ts
// 🔴 ブラウザ側のアップロード手順（`S-008` セクション 1。docs/05 §6.4 #18 → S3 → #19 / §14.2）。
//    T-05-06。
//
// ============================================================================
// 🔴 なぜ画面（`.tsx`）ではなくここに置くのか
// ============================================================================
// この手順は 3 段（署名の要求 → 実体の転送 → 確定）あり、**途中で失敗したときに何が残るか**が
// 業務上の意味を持つ:
//   - 署名だけ出た … 何も残らない（`UsageCounter` も `AuditLog` も動かない。docs/05 §6.4 #18）
//   - 転送だけ済んだ … S3 に孤児が残る（確定していないので台帳にも計上にも現れない）
//   - 確定まで済んだ … 版として並び、`SCANNING` で検査を待つ
// `app/**` はユニットテストの対象外（`vitest.config.ts`）なので、ここに置くことで
// 「失敗したときに次に何を出すか」をテストで固定できる。
import type { SkillSheetUploadTicket } from './service';

/** 確定（#19）の応答。 */
export type SkillSheetUploadOutcome =
  | { readonly ok: true; readonly version: number }
  /**
   * 🔴 失敗は**理由の分類まで**返す（画面が文言を出し分ける）。`code` はサーバの
   *    `ApiErrorBody.error.code`（docs/05 §15.2）であり、取れなければ `null`。
   */
  | { readonly ok: false; readonly code: string | null };

export type SkillSheetUploadInput = {
  readonly engineerId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly note: string | null;
  /** PUT のボディ（`File` / `Blob`）。テストでは任意の `BodyInit` を渡す。 */
  readonly body: BodyInit;
};

export type SkillSheetUploadDependencies = {
  /** 🔴 差し替え可能にするのはテストのためだけ（既定はブラウザの `fetch`）。 */
  readonly fetch: typeof fetch;
};

/**
 * 🔴 署名付き URL へ**実際に転送する必要があるか**。
 *
 * 判定材料は**受け取った URL の形だけ**であり、`APP_ENV` を見ない（`CLAUDE.md` §11.1 の
 * 「リクエストごとの環境分岐を書かない」）。`production` / `staging` / `sandbox` /
 * `development`（MinIO）ではいずれも `https://` / `http://` の URL が返るため、転送は必ず起きる。
 *
 * ⚠️ `demo` のモック実装（`MockObjectStore`）だけが `mock-object-store://` を返す。あちらは
 *    「署名を出した = そのキーに置かれた」とみなす実装（docs/05 §13.2）なので、転送する相手が
 *    そもそも存在しない。ここで `fetch` すると必ず失敗し、**モックなのにアップロードできない**
 *    という、実装のバグと見分けのつかない状態になる。
 */
export function requiresDirectTransfer(uploadUrl: string): boolean {
  return uploadUrl.startsWith('https://') || uploadUrl.startsWith('http://');
}

/** 応答から `ApiErrorBody.error.code` を取り出す（取れなければ `null`）。 */
async function errorCodeOf(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    const code = (body as { error?: { code?: unknown } }).error?.code;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

/**
 * 🔴 `S-008` のアップロード（#18 → S3 → #19）。
 *
 * 🔴 **確定（#19）まで通って初めて成功である。** 転送だけ成功して確定に失敗した場合は
 *    `ok: false` を返す —— 画面に「アップロードしました」と出してはならない（版は存在せず、
 *    検査も走らない）。利用者はもう一度アップロードすればよく、同じ手順が最後まで進む
 *    （確定は `objectKey` で冪等。`service.ts` の 🔴）。
 */
export async function uploadSkillSheet(
  input: SkillSheetUploadInput,
  deps: SkillSheetUploadDependencies,
): Promise<SkillSheetUploadOutcome> {
  // ① 署名の要求（ストレージ上限・サイズ・拡張子はここで弾かれる。docs/05 §14.2）。
  const ticketResponse = await deps.fetch(
    `/api/engineers/${encodeURIComponent(input.engineerId)}/skill-sheets/upload-url`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileName: input.fileName,
        contentType: input.contentType,
        byteSize: input.byteSize,
      }),
    },
  );
  if (!ticketResponse.ok) return { ok: false, code: await errorCodeOf(ticketResponse) };
  const ticket = (await ticketResponse.json()) as SkillSheetUploadTicket;

  // ② 実体の転送（ブラウザ → S3。Vercel のボディ上限を経由しない。docs/03 申し送り 23）。
  //    🔴 `requiredHeaders` を**そのまま**付ける（1 つでも欠けると署名が一致せず S3 が 403）。
  if (requiresDirectTransfer(ticket.uploadUrl)) {
    const put = await deps.fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: { ...ticket.requiredHeaders },
      body: input.body,
    });
    if (!put.ok) return { ok: false, code: null };
  }

  // ③ 確定（版の採番・計上・監査はここで起きる）。
  const confirmResponse = await deps.fetch(
    `/api/engineers/${encodeURIComponent(input.engineerId)}/skill-sheets`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ objectKey: ticket.objectKey, note: input.note }),
    },
  );
  if (!confirmResponse.ok) return { ok: false, code: await errorCodeOf(confirmResponse) };
  const confirmed = (await confirmResponse.json()) as { readonly version: number };
  return { ok: true, version: confirmed.version };
}
