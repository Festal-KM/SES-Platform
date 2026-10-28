# 別の端末・AIからAWS開発を引き継ぐ手順

更新日: 2026-10-28。最初に `CLAUDE.md`、`HANDOFF.md`、本書、`docs/DEPLOY-AWS.md` を読む。画面を触る場合は `UI_GUIDELINES.md` も読む。

## 方針と確認済みの状態

ソース編集とブラウザ操作は各自のPC、アプリ・DB・Redis・worker・重いビルドはAWSで行う。ローカルでNext.jsやDockerを立ち上げて代用しない。他プロジェクトのプロセスを止めない。

アカウントは `117425831827`、リージョンは `ap-northeast-1`。development / demo / productionを分ける。ドメイン `bizorch.com` はCloudflare管理。

現時点は移行途中。開発EC2とコンテナの起動は確認したが、開発画面 `/signin` のHTTP疎通はタイムアウトした。利用可能とは報告しない。ソース同期・アプリ配備・CI/CDは別ブランチ `feat/aws-deployment-pipeline` で作業中であり、mainにあるものとして案内しない。本書公開だけで移行完了と扱わない。

## 新しいPCの準備

1. Git、Node.js 24系、AWS CLI v2、GitHub CLI、AWS Session Manager pluginを導入する。
2. `Festal-KM/SES-Platform` をcloneしてルートへ移動し、上記の資料を読む。既存checkoutの未コミット変更を消さない。
3. AWSは各担当者の認証情報を使う。他人のアクセスキーを共有しない。組織がSSOを採用している場合は `aws configure sso`、`aws sso login --profile <各自のプロファイル>` を使う。
4. 必要ならPowerShellで `$env:AWS_PROFILE = '<各自のプロファイル>'` を設定。`aws sts get-caller-identity --query Account --output text` が上記IDと一致することを確認する。不一致なら変更操作を中止する。
5. `git fetch origin` 後、最新の `origin/main` から依頼ごとのブランチを作る。`aws --version`、`node --version`、`gh auth status`、`session-manager-plugin --version` を確認する。

EC2の起動停止・SSM接続・ソース転送に必要な開発用権限を管理者から付与してもらう。権限不足をAdministratorAccessの自己付与で回避しない。PCの絶対パスや個人のプロファイル名を他の人の前提にしない。

## 起動・接続・停止

リポジトリのルートで実行する。

```powershell
node scripts/aws-development.mjs status
node scripts/aws-development.mjs start
node scripts/aws-development.mjs status
```

`status` が示すインスタンスIDを使う。現在は `i-0bc41c9e860ebe14c`。runningだけでは画面の準備完了を意味しない。初回構築用の `init` を日常操作で実行しない。

シェル接続は `aws ssm start-session --region ap-northeast-1 --target <インスタンスID>`。ブラウザ用転送は別ターミナルで以下を実行し、接続中は開いたままにする。

```powershell
aws ssm start-session --region ap-northeast-1 --target <インスタンスID> --document-name AWS-StartPortForwardingSession --parameters '{"portNumber":["3000"],"localPortNumber":["3000"]}'
```

接続先で `cd /workspaces/ses-platform`、`docker ps` を確認し、`curl -I --max-time 60 http://127.0.0.1:3000/signin` で応答を確認する。準備できたらPCで `http://localhost:3000/signin` を開く。初回コンパイル中か起動失敗かを切り分ける。SSHや3000番をインターネットに公開しない。

PCの3000番を他プロジェクトが使っていたら止めない。別ポートを使う際はアプリorigin・認証設定も合わせる。ログの秘密値・接続URL・業務データをチャットやPRに貼らない。

ソース更新手順は同期スクリプトのmain反映・実機検証後に確定する。未検証のコマンドを完成済みとして案内しない。共有VMを別担当者が使用中なら無断でソースを上書きしない。

終了後は `node scripts/aws-development.mjs stop`、続いて `status` でstoppedを確認する。停止してもディスクとデータは保持される。起動から8時間後以降の定期検査で自動停止する。長時間作業では `start` の再実行で期限を延長できる。停止中もディスク等の保存費は残る。

## 秘密値・外部連携

東京のSecrets Manager `/ses-platform-production/external` に `ANTHROPIC_API_KEY`、`SENTRY_DSN`、`SES_DEFAULT_FROM_ADDRESS`、`OPENAI_API_KEY` を保管する。値はGit・手順書・チャットに記載しない。存在確認で値を表示しない。本番キーを開発環境へ転送しない。

OpenAIキーは将来用の保管のみ。現在のアプリはClaudeを使う。キーの存在を理由にOpenAI送信や自動切替を有効にしない。Sentryは合成テストイベントの受付まで確認済みで、実アプリからの送信は別に検証する。SES本番送信承認も含め、メール設定は未完。非本番から実在の相手に送信しない。

## デモ・本番の配備とRailway停止

予定URLは `https://demo-es.bizorch.com` と `https://es.bizorch.com`。証明書・ALB作成だけで稼働済みと扱わない。CI/CDと配備・ロールバック手順は構築中。mainへ直接pushしない。PRのCI結果を確認し、配備コミット・対象環境・migration・HTTP・ログイン・権限分離・添付・workerを実機検証する。本番はバックアップ復元と監視・実送信設定も確認する。失敗時にDBをresetしない。

宮田から「AWSがしっかり完成したらRailwayは停止してよい」と承認済み。同じ許可を再度求める必要はないが、以下が揃うまでは維持する。

1. AWSデモのHTTPS・ログイン・主要操作・実送信禁止を確認済み。
2. 旧デモのデータ引き継ぎ要否を確認し、必要なバックアップと復元方法を確保済み。
3. Git経由の配備と復旧を検証し、確定した手順をmainに掲載済み。
4. 利用者が新URLを使えることと、旧環境に処理が残っていないことを確認済み。

対象プロジェクト・環境・サービスを照合してRailwayの実行サービスを停止する。DB・ボリューム・プロジェクトの削除は行わない。停止後に残る課金対象も報告する。

## 引き継ぎ記録

PR URL、配備コミット、環境、検証結果、未確認項目、次の作業、停止したサービスをHANDOFFとPRに残す。資源作成・コンテナ起動・画面利用可能・本番移行完了を区別する。
