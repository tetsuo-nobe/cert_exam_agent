# 受験予約エージェント バックエンド (AWS SAM)

受験予約エージェントが利用する AWS リソースを AWS SAM で定義・デプロイします。
認証はフロントエンド（Amplify UI コンポーネント）から **SRP 方式**で Cognito に直接サインインする構成です。
Cognito Hosted UI（Managed UI）は使用しません。

## 作成されるリソース

| リソース | 用途 |
| --- | --- |
| S3 バケット (`ReservationBucket`) | 受験予約確認書 PDF の格納。パブリックアクセスは全面ブロックし、閲覧は署名付き URL 経由のみ（新しいタブで直接表示）。 |
| Cognito User Pool (`UserPool`) | サインイン用。メールアドレスでサインインし、`name`（受験者名）を保持。 |
| Cognito User Pool Client (`UserPoolClient`) | フロントエンド(SPA)用。クライアントシークレット無し、SRP 認証。 |

## 前提

- AWS SAM CLI がインストール済み
- AWS 認証情報が設定済み（`aws configure` など）

## デプロイ

`backend` フォルダで以下を実行します。

```powershell
sam validate --lint
sam deploy --guided
```

`--guided` で以下のパラメータを指定します。

| パラメータ | 説明 | 例 |
| --- | --- | --- |
| `ProjectName` | リソース名のプレフィックス | `exam-agent` |
| `PdfExpirationDays` | PDF を自動削除するまでの日数 | `30` |

2 回目以降は `sam deploy` だけで `samconfig.toml` の設定が使われます。

## デプロイ後の設定値

`sam deploy` 完了後、Outputs に以下が表示されます（`sam list stack-outputs --stack-name exam-agent-backend` でも確認可能）。

| Output | 使い道 |
| --- | --- |
| `ReservationBucketName` | エージェントの環境変数 `EXAM_RESERVATION_BUCKET` に設定する。 |
| `CognitoDiscoveryUrl` | AgentCore Runtime の Inbound Auth(JWT) の `discoveryUrl` に設定する。 |
| `UserPoolClientId` | Inbound Auth の `allowedClients` / `allowedAudience`、およびフロントエンド(Amplify)の Cognito 設定に使う。 |
| `UserPoolId` | フロントエンド(Amplify)の Cognito 設定に使う。 |
| `CognitoIssuerUrl` | Cognito の発行者 URL（参考値）。 |
| `Region` | 各種クライアントのリージョン設定。 |

## フロントエンド(Amplify)の設定イメージ

Amplify UI + SRP 方式では、Hosted UI は使わず以下の値だけでサインインを構成できます。

```ts
// aws-amplify v6 の例
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: "<UserPoolId>",
      userPoolClientId: "<UserPoolClientId>",
      // signUpVerificationMethod や loginWith は用途に応じて設定
    },
  },
});
```

## エージェント側との接続

1. `EXAM_RESERVATION_BUCKET` に `ReservationBucketName` を設定する（`agentcore.json` の runtime 環境変数、またはデプロイ時の環境変数）。
2. AgentCore Runtime の実行ロールに、このバケットへの `s3:PutObject` と `s3:GetObject`（署名付き URL 用）権限を付与する。
3. AgentCore Runtime の Inbound Auth を `CUSTOM_JWT` にし、`discoveryUrl` に `CognitoDiscoveryUrl`、`allowedClients` に `UserPoolClientId` を設定する。

## 削除

S3 バケットは誤削除防止のため `DeletionPolicy: Retain` にしています。スタックを削除してもバケットは残るため、不要な場合は中身を空にしてから手動で削除してください。

```powershell
sam delete --stack-name exam-agent-backend
```
