# デモ・本番のリリース

## 配備の流れ

常設ブランチはmainだけを使う。環境別ブランチを作らず、同じコミットとイメージdigestを記録する。PCではアプリやDockerを起動しない。PRとmainのCIを省略しない。

Actionsの **AWSデモ・本番へ反映** を開き、mainブランチ、反映先、完全な40桁コミットSHAを選ぶ。mainに統合されていないコミットや、同じコミットのmain向けCI全体が成功していない場合は拒否する。

| 反映先 | 処理 |
| --- | --- |
| demo | AWS CodeBuildで一度ビルドし、変更できないコミットタグをECRに保存。固定digestで設定検査、migration、ECSのweb・worker更新、公開HTTPSの検査を実行 |
| production | GitHub Environmentの承認を待つ。デモ配備が成功した記録からdigestを読み、本番ECRへ同じdigestのままコピーして反映。本番向けに再ビルドしない |

本番の承認者はFestal-KM。承認待ちのActionsにあるReview deploymentsから承認する。現在の単独管理者も自分の実行を明示的に承認できるが、管理者による承認省略は許可しない。担当者が増えたら承認者を追加し、自己承認を禁止する運用に切り替える。

GitHubにAWSの長期アクセスキーやアプリ用APIキーを置かない。各Environmentをmainのみに制限し、不変リポジトリIDと環境名を完全一致で照合するOIDCロールを使う。配備ロールにはアプリの秘密値取得を許可しない。秘密値はECS実行ロールがSecrets Managerから注入する。migration用のDB管理接続は通常のweb・workerに渡さない。

## 初回の管理者設定

承認されたAWSアカウント117425831827、東京リージョンで実行する。

```powershell
node scripts/aws-provision-application.mjs demo
node scripts/aws-provision-application.mjs production
node scripts/aws-build.mjs demo provision
node scripts/aws-provision-release.mjs
node scripts/aws-runtime.mjs demo
node scripts/aws-runtime.mjs production
```

各環境のALB・証明書・DNSも必要。`ses-platform-<環境>-foundation`、`-application`、`-ingress`が正常でなければ反映しない。通常の反映では上記の管理者設定を毎回実行しない。認証・暗号鍵は再生成せず、同じ環境の値を保つ。

runtime設定は各環境の`/ses-platform-<環境>/runtime`、DBロールのパスワードは`/ses-platform-<環境>/roles`。配備用SSM Parameter `/ses-platform/<環境>/deployment`には秘密値を入れず、キー名とARNだけを記録する。本番用外部API設定を変更したときは、管理者がruntimeの許可された項目へ反映する。未使用のOpenAIキーをアプリへ配らない。

デモ初回は、web・workerのサービスも実行中タスクも存在しない場合だけ、既存の合成seedとロール別アカウントを投入する。通常配備ではseedを実行しない。投入専用タスク中だけテーブル所有者のFORCE RLSを一時解除し、finallyで戻し、解除残りが0であることを検査してから起動する。未知のテナントが存在する場合は中止する。既存データをresetしない。本番でseedモードを指定すると接続前に拒否する。

合成seedは投入専用のRDS管理接続を使う。DB管理者のパスワードは一回限りの管理タスクにだけ注入し、web・workerやGitHub Actionsへ渡さない。app_migratorや通常アプリにrds_superuserを付与して回避しない。

## 確認と本番承認

配備成功はECSの指定タスク定義への更新と`/signin`のHTTP 200を示す。業務操作まで確認済みという意味ではない。本番の承認前にデモで次を確認する。

1. 各ロールのログイン、運営者とテナントの認証分離、必要な2FA。
2. 案件・人材の主要操作と、テナント・取引先間の情報分離。
3. 添付の署名付きアップロード、スキャン、worker処理。
4. 本番のメール認証・SES本番アクセス・監視・外部サービス設定。
5. 本番のバックアップ復元とmigration前後の互換性。

本番用サービス設定が未完の状態で、モックやダミーのキーを入れて設定検査を通してはいけない。本番アプリの公開準備が整うまでは承認しない。デモは外部送信をモックに固定し、実在の宛先へ送信しない。

## 失敗時

Actionsの実行概要に環境・コミット・digestと直前のタスク定義が残る。ECSは起動失敗時にサービス単位の自動復旧を試みるが、webとworker全体の復旧完了を保証するものではない。両サービスの状態を確認する。CloudWatchのログ全文を公開PRへ貼らない。

設定検査またはmigrationに失敗した場合は、サービス更新へ進まない。タイムアウトしたタスクは継続している場合があるため、再送前に状態を確認する。アプリの復旧は、デモの確認済み記録が残る以前のコミットを同じワークフローで指定する。DBを自動で巻き戻したりresetしたりしない。旧アプリと新しいDBの互換性がない場合は、修正migrationを作るか、管理者が復元手順に従う。

初回seedタスクが強制終了しFORCE RLSが戻っていなければ、次のmigration検査も失敗してアプリを起動しない。既存アプリを起動せず、管理者がRLSを復旧して解除残り0を確認する。

RailwayはAWSデモのログイン・主要操作・データ保持と復旧を確認してから停止する。DB・ボリュームは削除しない。
