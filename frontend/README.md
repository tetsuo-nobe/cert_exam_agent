# 受験予約エージェント フロントエンド (Next.js)

認定試験の受験予約エージェント（AgentCore Runtime）にアクセスするフロントエンドです。

## 技術スタック

- Next.js (App Router) + TypeScript
- `aws-amplify` + `@aws-amplify/ui-react`（サインイン: Amplify UI の `Authenticator` コンポーネント、SRP認証。Cognito Hosted UI は使用しない）

## 構成

```
src/
├── app/
│   ├── layout.tsx          Providers(Authenticator)でラップ
│   ├── providers.tsx       Amplify初期化 + Authenticator設定
│   ├── page.tsx            チャットUI本体
│   └── api/agent/invoke/
│       └── route.ts        AgentCore Runtimeへのプロキシ(SSE中継)。サーバー側のみで実行
└── lib/
    ├── amplify-config.ts   Amplify設定(Cognito User Pool ID/Client ID)
    └── parse-agent-stream.ts  SSEパース、テキスト差分の抽出
```

## 呼び出しフロー

```
ブラウザ (Authenticator でサインイン、SRP)
  → fetchAuthSession() で ID トークン取得
  → fetch("/api/agent/invoke", { Authorization: Bearer <IDトークン>, prompt, sessionId })
Next.js API Route (/api/agent/invoke, サーバー側)
  → AgentCore Runtime の /invocations エンドポイントへ Authorization ヘッダーを転送
  → 返ってきた SSE (text/event-stream) をそのままブラウザへ中継
ブラウザ側で SSE をパースし、contentBlockDelta.delta.text を連結して表示
```

AgentCore Runtime の ARN・リージョンはサーバー側の環境変数にのみ保持し、ブラウザには一切露出しません。

## 環境変数

`.env.local.example` をコピーして `.env.local` を作成し、値を設定してください。

| 変数 | 用途 | 値の取得元 |
| --- | --- | --- |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | Cognito User Pool ID（ブラウザで使用） | `backend` の SAM Outputs `UserPoolId` |
| `NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID` | Cognito User Pool Client ID（ブラウザで使用） | `backend` の SAM Outputs `UserPoolClientId` |
| `AGENT_RUNTIME_ARN` | AgentCore Runtime の ARN（サーバー側のみ） | `agentcore status` または `agentcore/.cli/deployed-state.json` |
| `AGENT_RUNTIME_REGION` | AgentCore Runtime のリージョン（サーバー側のみ） | 例: `us-east-1` |

## 開発

```powershell
npm install
npm run dev
```

`http://localhost:3000` を開くとサインイン画面が表示されます。サインアップ時に受験者名（`name`属性）の入力が必須です。ここで入力した名前が、エージェントが受験予約確認書に記載する受験者名として使われます（Cognito ID トークンの `name` クレームをエージェント側で読み取ります）。

## ビルド

```powershell
npm run build
```

## 注意事項

- 署名付きURL（受験予約確認書PDF）はチャット内のリンクをクリックすると新しいタブで直接開きます。ダウンロード用のBlob処理は行っていません。
- セッションID（会話の継続性）はブラウザのタブを開いている間だけ保持されます（`crypto.randomUUID()` でページ読み込み時に生成）。リロードすると新しい会話として扱われます。

## AWS Amplify Hosting へのデプロイ（モノリポ構成）

このリポジトリは `backend/`（SAM）、`examAgent/`（AgentCore）、`frontend/`（このNext.jsアプリ）が同列に並ぶモノリポです。
リポジトリルートに配置した `amplify.yml` がモノリポ用のビルド設定で、`appRoot: frontend` を指定しています。

Amplify Hosting でアプリを作成する際の手順:

1. リポジトリを接続し、ブランチを選択する画面で **「モノリポである」（My app is a monorepo）** にチェックを入れる
2. アプリのルートパスに `frontend` を指定する（これで `AMPLIFY_MONOREPO_APP_ROOT=frontend` が自動設定される）
3. ビルド設定はリポジトリルートの `amplify.yml` が自動的に使われる（コンソール側の設定より優先される）
4. Amplify Hosting のコンソールで環境変数を設定する（`.env.local` と同じ内容）:
   - `NEXT_PUBLIC_COGNITO_USER_POOL_ID`
   - `NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID`
   - `AGENT_RUNTIME_ARN`
   - `AGENT_RUNTIME_REGION`
5. Next.js の SSR（`/api/agent/invoke` を含む API Routes）を使うため、Amplify Hosting は自動的にコンピュートホスティング（Next.js SSRアプリ向け）としてデプロイする

デプロイ後、Cognito User Pool Client の設定（`backend/template.yaml`）に本番フロントエンドのオリジンを許可リストに追加する必要が出てくる場合があります（現状はSRP認証のみでCallbackURL等は使っていないため、追加設定は基本的に不要です）。
