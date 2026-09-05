# `tests/fixtures/ses`

`POST /api/webhooks/ses` の受信パイプライン（docs/05 §8.5）を検証するためのフィクスチャ。

🔴 **実データ由来のものを置かない**（`BR-47` / SP-04 §5「外部 API のモック方針」）。
氏名・メールアドレス・トークン・AWS アカウント ID はすべて架空値である
（`example.co.jp` / `example.com` / `100000000001` / ゼロ埋めのトークン）。

🔴 `Signature` は `PLACEHOLDER` のままである。**テストが自己生成した鍵で署名し直す**
（実在の SNS エンドポイントにも Amazon の証明書にも接続しない）。
署名対象文字列の組み立ては `apps/web/lib/webhooks/sns.ts` の `snsStringToSign` が持つ。

| ファイル | 用途 |
|---|---|
| `bounce.notification.json` | バウンス（`Bounce`）。`EmailEvent` への正規化と `dedupeKey` の検証 |
| `complaint.notification.json` | 苦情（`Complaint`）。同上 |
| `subscription-confirmation.json` | 購読確認。🔴 `Token` / `SubscribeURL` を DB に保存しないことの検証 |
