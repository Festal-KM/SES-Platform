# AWS 開発・営業デモ・本番

> 2026-10-28追記: 別端末・AI向けの入口は [AWS-AGENT-RUNBOOK.md](AWS-AGENT-RUNBOOK.md)。ドメインはCloudflare管理の `bizorch.com` に決定した。以下は初期基盤段階の記録であり、アプリ配備・CI/CDの完了を意味しない。最新の検証状況とRailway停止条件は引き継ぎ手順を参照する。

2026-10-26 の宮田の指示で、AWS アカウント `117425831827`、東京リージョン `ap-northeast-1` に3環境を構築する。ドメインは未定。Railway は更新せず、AWS の動作確認が完了するまでは既存デモを維持する。

## 確定した要件と今回の範囲

| 環境 | APP_ENV | 稼働方針 | データ |
|---|---|---|---|
| 開発 | development | 開発時だけ起動。停止してもデータ保持 | 合成・検証データ |
| 営業デモ | demo | すぐ実演できるよう常時稼働 | 合成データのみ。全外部連携はモック |
| 本番 | production | 常時稼働。監視・バックアップを設定 | 実顧客データ。他環境への持ち出し禁止 |

今回作成するのは**基盤と開発用の作業サーバー**であり、3つのアプリが利用できる状態を意味しない。Web、worker、DB、Redis、HTTPS、通知先、アプリの秘密値は後続の構築対象。空の ECS クラスターにタスクは起動しない。

アカウントを共有する判断は、これまでのアカウント分離の設計からの変更である。`packages/config/src/schema.ts` に明示指定の `AWS_ISOLATION_MODE=resource` を追加した。未指定時は従来の `account` モードを維持し、非本番と本番のID一致を拒否する。本番IDを偽の値にして回避しない。モック禁止・本番APIキーの拒否・SSL・暗号鍵の検査も維持する。

`resource` は承認された3環境だけで使え、共通アカウントと本番の期待IDの一致、環境別S3バケット・KMSエイリアスARN・SESトピックARN・設定セット、環境別RDS／Redisのホスト名とDBロールを検査する。RedisはTLS必須。開発だけはDB／Redis／S3互換サービスのループバック接続を認める。デモ・本番のS3の独自エンドポイントと固定アクセスキー、アプリプロセスのseed用特権接続は拒否する。IAMによる拒否と組み合わせて運用し、既存ローカルやRailwayの環境変数は変更しない。

## 基盤

定義は `infra/aws/foundation.mjs`、操作は `scripts/aws-foundation.mjs`。CloudFormation スタック名は `ses-platform-<環境>-foundation`。接続先アカウントが承認済みの値と異なる場合は、検証・変更を中止する。

各環境に以下を分けて作る。

- VPC、2つの公開サブネット、2つの非公開サブネット。CIDR は順に `10.80.0.0/16`、`10.81.0.0/16`、`10.82.0.0/16`。環境間の接続は作らない。
- S3 バケットと暗号鍵。公開禁止、TLS必須、バージョニング有効、KMSによる暗号化。バケットと鍵はスタック削除・置換時も保持する。
- ECR リポジトリ。不変のタグ、プッシュ時スキャン。実行イメージはコミット単位で指定する。
- CloudWatch Logs と空の ECS クラスター。
- ECS アプリ用ロールと起動用ロール。アプリ用ロールは自環境のバケットと鍵だけを許可し、他環境のS3・KMS、ロールの引受、秘密値の直接取得は明示的に拒否する。非本番では Amazon SES と SNS の送信も拒否する。起動用ロールの秘密値取得は `/ses-platform-<環境>/` 配下だけに限定する。

NAT Gateway・ロードバランサー・実行コンテナ・DB は基盤段階で作らない。秘密値そのものも生成・登録しない。KMSキーなど、基盤の維持費は発生する。

```powershell
node scripts/aws-foundation.mjs validate development
node scripts/aws-foundation.mjs deploy development
node scripts/aws-foundation.mjs status development
# demo / production も同じ操作。全環境を一括で更新しない。
node --test infra/aws/foundation.test.mjs
node scripts/aws-verify-isolation.mjs
```

スタックには削除保護を有効にする。既存のSNSなど、別プロジェクトの資源・VPC・権限・DNSは変更しない。

## 開発用の作業サーバー

`infra/aws/development.mjs` が `ses-platform-development-workspace` スタックを定義する。Amazon Linux 2023、t3.large（2 vCPU／8 GiB）、暗号化gp3ディスク80 GiB。DockerとGitを初期化する。アプリ・DB・Redis・ソースの配備はまだ行わない。

SSHを含め、インターネットからの着信ポートは開けない。AWS Systems ManagerのSession Managerで接続する。作業用IAMロールは実送信・秘密値の取得・ロールの引受・IAM変更を拒否し、ソース搬入用の自環境S3 `bootstrap/` だけを読み取れる。作業サーバーは公開サブネットからHTTP／HTTPSでOS・コンテナ等の公開パッケージを取得する。S3 Gateway Endpointは非公開サブネットだけに付け、公開OSリポジトリの取得を妨げない。

```powershell
# init は初回構築／意図した更新時だけ。既存VMのAMIを維持し、ネットワーク変更は拒否する。
node scripts/aws-development.mjs init
# 日々の操作はこちら。環境名は受け付けず、開発の1台だけを操作する。
node scripts/aws-development.mjs start
node scripts/aws-development.mjs status
node scripts/aws-development.mjs stop
```

起動から8時間後以降、最初の15分ごとの検査で自動停止する。稼働中に `start` を再実行すると期限を延長する。自動停止用Lambdaの停止権限は、この1台の識別子かつ開発・プロジェクトのタグが一致する場合だけに限定する。別環境・他プロジェクトのサーバーを停止しない。

停止・再開ではディスクを保持する。インスタンス自体にも削除保護を付け、スタック削除／置換時にもインスタンスを保持し、ディスクを自動削除しない。停止中はコンピュート課金が止まるが、80 GiBのディスク保存費は残る。作業終了後は停止し、`status` の `stopped` を確認する。

接続はAWSコンソールのSession Managerでも可能。`status` に表示する `aws ssm start-session` をローカルで使うにはSession Manager pluginが必要。このWindows端末ではまだ導入していない。プラグインの導入前でもAWS CLIのRun CommandでDocker疎通・ファイル保持を検査できる。

`aws-verify-isolation.mjs` は作成済みのIAMロールに対して23件のポリシーシミュレーションを実行する。自環境S3の許可、他環境S3・自環境以外のKMS鍵の拒否、別ロールの引受の拒否、アプリからの秘密値取得の拒否、起動用ロールの秘密値取得範囲、非本番の実メール送信拒否を照合する。実データの読み書きやメール送信はしない。これはDBの接続・テナント分離・アプリの起動を検証するテストではない。

## 続く構築

1. 開発用EC2・保存ディスク・SSM接続・自動停止は構築済み。次にWeb・worker・PostgreSQL・Redisを配備し、環境別の秘密値をサーバー内で生成する。本番と同じmigrationを使えるようにする。アプリ未配備の状態を開発画面が利用可能と報告しない。
2. デモ・本番はECS FargateのWeb／workerと、環境別RDS PostgreSQL／Redisを使う案を検証する。本番はDBの複数AZ・復元手順・アラームも含める。基盤だけを本番稼働済みとは扱わない。
3. 同一アカウント向けの起動時検査は追加済み。実際のDB／Redisの接続先と環境別の秘密値を設定し、起動と拒否の両方を確認する。RLS用ロールの作成は既存の `000_roles.sql` を唯一の定義とし、RDSで実行可能かを先に検証する。
4. ドメイン決定後、証明書・HTTPS・環境別URLを設定する。Secure Cookieを使うため、営業用URLをHTTPで公開して仮運用しない。S3のCORSはその環境のHTTPS originだけに限定する。
5. 別タスクでmigrationを実行する。Web／workerにmigration用認証情報を渡さない。デモには合成データを投入し、本番には投入しない。
6. 認証・案件操作・コピー・権限分離・添付・ジョブを確認する。デモから実宛先へ送れないことを確認する。本番のメール・スキャン・監視・外部APIの設定が揃うまでは、本番の利用を開始しない。

開発VMを停止してもEBS・S3などの保存費は残る。RDSを開発に採用し直す場合は、停止後7日で自動起動する仕様を含めて再設計する。

参照: [RDSの停止](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html)、[S3のCloudFormation定義](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3-bucket.html)。
