# AWSへの反映と確認

## 運用

環境ごとの常設ブランチは作らない。作業ブランチをPR経由でmainへ統合する。既存CIのビルド・型・静的検査・ユニット・情報分離・E2E・依存関係監査を省略しない。PCではアプリ、DB、Docker、重いビルドを起動しない。

| 環境 | 反映方法 | 現在の対応 |
| --- | --- | --- |
| 開発 | mainのCI全体が成功した後、自動反映 | `AWS開発環境へ反映` |
| デモ | 確認済みmainから成果物を作り、手動反映 | `AWSデモ・本番へ反映`（実機検証中） |
| 本番 | デモで確認した同じ成果物を承認後に反映 | 同ワークフローと本番Environmentの承認（公開準備は未完） |

環境変数・認証鍵・DB・保存先は独立させる。本番キーを開発へ配らない。デモ・本番は [`AWS-RELEASE-RUNBOOK.md`](./AWS-RELEASE-RUNBOOK.md) の専用経路を使う。開発のワークフローを流用しない。

## 開発への反映

mainの`CI`全体が成功すると`AWS開発環境へ反映`が起動する。PR向けCIの成功だけでは反映しない。後続mainがある古いCIの自動反映は省略する。

GitHub Actionsの実行概要に対象コミットとSSMコマンドIDが記録される。AWS VMで依存関係・共通パッケージ・Nextの本番用成果物を作り、migrationを適用してwebとworkerを起動する。`APP_ENV=development`は維持し、外部送信はモックを使う。DBと暗号鍵は保持する。VM内部と公開URLの`/signin`が正常応答すると成功になる。機能別の動作確認は別途行う。確認URLは **https://dev-es.bizorch.com/signin**。

開発VMが停止中なら勝手に起動せず、「反映を省略」と実行概要に残す。`node scripts/aws-development.mjs start`で起動後、手動で反映する。起動だけでは停止中のmain更新は反映されない。

GitHubの同時実行制御とVMの排他ロックでCI同士の上書きを防ぐ。配備の途中ではキャンセルしない。手動ソース転送を行う担当者もActionsの配備実行中には転送しない。

## 手動反映と復旧

Actions → `AWS開発環境へ反映` → `Run workflow`を開く。実行ブランチはmain。コミット欄は空なら最新main、指定するならmainに統合済みの完全な40桁SHAを入力する。同じコミットに対するmainのCI成功が必要。

```powershell
gh workflow run aws-deploy-development.yml --ref main
gh run list --workflow aws-deploy-development.yml --limit 5
gh run view <実行ID>
```

失敗時は管理者がSSMコマンドIDを調査する。SSM出力全文をPR・チャット・公開Actionsログへ転記しない。配備スクリプトもSSM出力本文を公開しない。

ビルド中は開発web・workerが一時停止する。失敗時は停止したままの場合がある。原因を修正して再実行するか、直前の正常コミットを指定して反映する。**migrationは自動で巻き戻さない。DB resetやseed resetを復旧に使わない。** 新しいmigrationと旧コードが共存できるか確認してから戻す。待機期限を超過してもAWS側で処理が続いている可能性があるため、SSMの状態を確認せず再送しない。

成功したコミットはVMの`/workspaces/ses-platform/.aws-deployed-commit`に記録する。未コミットソースを`aws-sync-development.mjs`で転送した場合、この記録だけで実コードがコミットに一致すると判断してはいけない。

## 管理者向け初期設定

`node scripts/aws-provision-cicd.mjs`で`ses-platform-cicd`スタックを作成する。アカウント117425831827を照合する。他のGitHub OIDC Providerが既に存在するアカウントでは、そのまま新規作成せず定義を見直す。

GitHub Environment `development`は配備可能ブランチをmainのみに制限する。AWSの信頼ポリシーは、このリポジトリの不変の組織ID・リポジトリIDと`environment:development`を完全一致で照合する。subject形式を変更した場合もワイルドカードで回避しない。

長期AWSアクセスキーをGitHubに登録しない。OIDC専用ロールは開発S3の配備フォルダへのアップロードと、開発VMに対する固定SSM Documentの実行だけを許す。汎用シェルDocument、EC2起動停止、IAM変更、Secrets Manager、本番の送信権限を与えない。SSMにはコミットとアーカイブハッシュだけを渡し、展開前にハッシュを照合する。

参考: [GitHub公式のAWS OIDC設定](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)。
