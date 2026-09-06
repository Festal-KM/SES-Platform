# `tests/fixtures/guardduty`

`POST /api/webhooks/guardduty` の受信パイプライン（docs/05 §8.5 / §9.6）と、
GuardDuty Malware Protection for S3 の**結果の正規化**（docs/03 §3.4.3）を検証するフィクスチャ。

🔴 **実データ由来のものを置かない**（`BR-47` / SP-05 §5「外部 API のモック方針」）。
バケット名・オブジェクトキー・AWS アカウント ID・版 ID はすべて架空値である
（`ses-platform-test` / ゼロ埋めの UUID / `100000000001`）。

🔴 **HMAC 署名はフィクスチャに含まれない。** 署名はヘッダ（`x-ses-platform-signature`）で運ばれ、
テストが `buildGuardDutySignatureHeader`（`packages/connectors/src/scan/guardduty.ts`）で
生成する。実在の AWS / GuardDuty には接続しない。

| ファイル | `scanResultStatus` | 期待する内部状態 | 用途 |
|---|---|---|---|
| `no-threats-found.json` | `NO_THREATS_FOUND` | `CLEAN` | 唯一の共有可（`BR-26`） |
| `threats-found.json` | `THREATS_FOUND` | `INFECTED` | 🔴 順序逆転テストの起点 |
| `unsupported.json` | `UNSUPPORTED` | `UNSCANNABLE` | 🔴 `CLEAN` として扱わない（docs/03 §3.4.3-3） |
| `access-denied.json` | `ACCESS_DENIED` | `FAILED` | 同上 |
| `scan-failed.json` | （無し。`detail.scanStatus='FAILED'`） | `FAILED` | 結果詳細を伴わないイベント |
| `unknown-status.json` | `SOMETHING_NEW` | （解釈不能） | 🔴 未知の値を `CLEAN` にも寄せない |

🔴 **`no-threats-found.json` と `threats-found.json` は同じ `objectKey` / `versionId` を持つ。**
「同じオブジェクト版に対して 2 つの判定が届く」（重複配信 / 順序逆転）を再現するためであり、
`dedupeKey`（`gd:{objectKey}:{versionId}`）が同一になることも併せて検証する。
