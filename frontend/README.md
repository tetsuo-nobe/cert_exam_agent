# 受験予約エージェント フロントエンド (Next.js)

認定試験の受験予約エージェント（AgentCore Runtime）にアクセスするフロントエンドです。

## 技術スタック

- Next.js (App Router) + TypeScript。**静的サイト (`output: "export"`) としてビルドし、サーバー機能(SSR/API Routes)は使わない**
- `aws-amplify` + `@aws-amplify/ui-react`（サインイン: Amplify UI の `Authenticator` コンポーネント、SRP認証。Cognito Hosted UI は使用しない）

## 構成

```
src/
├── app/
│   ├── layout.tsx          Providers(Authenticator)でラップ
│   ├── providers.tsx       Amplify初期化 + Authenticator設定
│   └── page.tsx            チャットUI本体
└── lib/
    ├── amplify-config.ts     Amplify設定(Cognito User Pool ID/Client ID)
    ├── agent-client.ts        AgentCore Runtime への直接呼び出し(ブラウザから)
    └── parse-agent-stream.ts  SSEパース、テキスト差分・ツール利用状況の抽出
```

## 呼び出しフロー

```
ブラウザ (Authenticator でサインイン、SRP)
  → fetchAuthSession() で ID トークン取得
  → AgentCore Runtime の /invocations エンドポイントへブラウザから直接 fetch
    (Authorization: Bearer <IDトークン>)
  → 返ってきた SSE (text/event-stream) をブラウザ側でパースして表示
```

**サーバー側のプロキシは使わない。** AgentCore Runtime のエンドポイントは `Access-Control-Allow-Origin: *`
を返すため、ブラウザから直接呼び出せる(検証済み)。呼び出しには Cognito が発行した JWT (Inbound Auth で
`aud` クレームを検証)が必須なため、AgentCore Runtime の ARN 自体がブラウザに見えても、それだけでは
呼び出せない。

### なぜサーバー側プロキシをやめたか

当初は Next.js の API Route (`/api/agent/invoke`) でサーバー側から AgentCore Runtime を呼び、SSE を
中継する構成だった。しかし **AWS Amplify Hosting の Next.js SSR compute はストリーミングレスポンス
(`ReadableStream`) を返す API Route をサポートしていない**ため、ローカルでは動作してもデプロイ後に
500 エラーになった。AgentCore Runtime が CORS に対応していることを確認できたため、サーバーを介さず
ブラウザから直接呼び出す構成に変更し、Amplify Hosting へは静的サイトとしてデプロイしている。

## 環境変数

`.env.local.example` をコピーして `.env.local` を作成し、値を設定してください。
**すべて `NEXT_PUBLIC_` プレフィックスが必要です**（ビルド時にブラウザ向けJSへ埋め込まれる値のため）。

| 変数 | 用途 | 値の取得元 |
| --- | --- | --- |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | Cognito User Pool ID | `backend` の SAM Outputs `UserPoolId` |
| `NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID` | Cognito User Pool Client ID | `backend` の SAM Outputs `UserPoolClientId` |
| `NEXT_PUBLIC_AGENT_RUNTIME_ARN` | AgentCore Runtime の ARN | `agentcore status` または `agentcore/.cli/deployed-state.json` |
| `NEXT_PUBLIC_AGENT_RUNTIME_REGION` | AgentCore Runtime のリージョン | 例: `us-east-1` |

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

`out/` ディレクトリに静的ファイルが出力されます。

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
4. Amplify Hosting のコンソールで環境変数を設定する（`.env.local` と同じ内容、4つすべて `NEXT_PUBLIC_` 付き）:
   - `NEXT_PUBLIC_COGNITO_USER_POOL_ID`
   - `NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID`
   - `NEXT_PUBLIC_AGENT_RUNTIME_ARN`
   - `NEXT_PUBLIC_AGENT_RUNTIME_REGION`
5. 静的サイト（`output: "export"`）としてビルドされるため、Amplify Hosting は静的ホスティングとしてデプロイする（SSR compute は使わない）
