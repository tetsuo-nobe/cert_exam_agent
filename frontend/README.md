# 受験予約エージェント フロントエンド (Vite + React)

認定試験の受験予約エージェント（AgentCore Runtime）にアクセスするフロントエンドです。

## 技術スタック

- Vite + React + TypeScript。サーバー機能を持たない、純粋な静的サイトとしてビルドされる
- `aws-amplify` + `@aws-amplify/ui-react`（サインイン: Amplify UI の `Authenticator` コンポーネント、SRP認証。Cognito Hosted UI は使用しない）

## 構成

```
src/
├── main.tsx              エントリポイント。Providers(Authenticator)でApp をラップ
├── Providers.tsx          Amplify初期化 + Authenticator設定
├── App.tsx                チャットUI本体
├── App.module.css         チャットUIのスタイル(CSS Modules)
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

## なぜ Next.js ではなく Vite なのか

当初は Next.js で実装していたが、AWS Amplify Hosting へのデプロイで次の問題が起きたため、
Vite + React に切り替えた。

1. Next.js の API Route でサーバー側から AgentCore Runtime を呼び、SSE を中継する構成にしていたが、
   **Amplify Hosting の Next.js SSR compute はストリーミングレスポンスをサポートしていない**ため、
   デプロイ後に 500 エラーになった。
2. AgentCore Runtime が CORS に対応していることを確認できたため、サーバーを介さずブラウザから直接
   呼び出す構成に変更し、Next.js を `output: "export"`（静的サイト生成）に変更した。
3. しかし Amplify Hosting のアプリ作成ウィザードは `package.json` の内容から Next.js を検出すると、
   ビルド設定に関わらず「SSR (Web Compute)」のデプロイパイプラインを自動的に選んでしまい、静的サイトの
   ビルド成果物に対して SSR 用のファイル（`required-server-files.json`）を要求してデプロイが失敗した。
   `amplify.yml` でビルド設定を静的サイト向けに変更しても、Amplify 側のフレームワーク自動検出・
   プラットフォーム判定は別の仕組みで動いており、都度エラーになった。

これらは Next.js 特有の自動検出に起因する問題であり、根本的に解決するにはアプリ作成後に
`aws amplify update-app --platform WEB` を都度実行する必要があるなど、運用上の複雑さが増していた。

一方で、このアプリはサーバー機能を一切使わない（ブラウザから直接 AgentCore Runtime を呼ぶ）ため、
そもそも Next.js を使う理由がなかった。Vite は最初から素の静的ファイル（HTML/CSS/JS）を出力するだけの
ビルドツールで、Amplify Hosting からは常に静的サイトとして認識される。ストリーミング表示・認証UI
（`@aws-amplify/ui-react`）などの要件はそのまま維持しつつ、Next.js 固有の自動検出問題を構造的に
回避できるため、Vite + React に切り替えた。

## 環境変数

`.env.local.example` をコピーして `.env.local` を作成し、値を設定してください。
**すべて `VITE_` プレフィックスが必要です**（ビルド時にブラウザ向けJSへ埋め込まれる値のため）。

| 変数 | 用途 | 値の取得元 |
| --- | --- | --- |
| `VITE_COGNITO_USER_POOL_ID` | Cognito User Pool ID | `backend` の SAM Outputs `UserPoolId` |
| `VITE_COGNITO_USER_POOL_CLIENT_ID` | Cognito User Pool Client ID | `backend` の SAM Outputs `UserPoolClientId` |
| `VITE_AGENT_RUNTIME_ARN` | AgentCore Runtime の ARN | `agentcore status` または `agentcore/.cli/deployed-state.json` |
| `VITE_AGENT_RUNTIME_REGION` | AgentCore Runtime のリージョン | 例: `us-east-1` |

## 開発

```powershell
npm install
npm run dev
```

`http://localhost:5173` を開くとサインイン画面が表示されます。サインアップ時に受験者名（`name`属性）の入力が必須です。ここで入力した名前が、エージェントが受験予約確認書に記載する受験者名として使われます（Cognito ID トークンの `name` クレームをエージェント側で読み取ります）。

## ビルド

```powershell
npm run build
```

`dist/` ディレクトリに静的ファイルが出力されます。

## 注意事項

- 署名付きURL（受験予約確認書PDF）はチャット内のリンクをクリックすると新しいタブで直接開きます。ダウンロード用のBlob処理は行っていません。
- セッションID（会話の継続性）はブラウザのタブを開いている間だけ保持されます（`crypto.randomUUID()` でページ読み込み時に生成）。リロードすると新しい会話として扱われます。

## AWS Amplify Hosting へのデプロイ（モノリポ構成）

このリポジトリは `backend/`（SAM）、`examAgent/`（AgentCore）、`frontend/`（このVite/Reactアプリ）が同列に並ぶモノリポです。
リポジトリルートに配置した `amplify.yml` がモノリポ用のビルド設定で、`appRoot: frontend` を指定しています。

Amplify Hosting でアプリを作成する際の手順:

1. リポジトリを接続し、ブランチを選択する画面で **「モノリポである」（My app is a monorepo）** にチェックを入れる
2. アプリのルートパスに `frontend` を指定する（これで `AMPLIFY_MONOREPO_APP_ROOT=frontend` が自動設定される）
3. ビルド設定はリポジトリルートの `amplify.yml` が自動的に使われる（コンソール側の設定より優先される）。Viteアプリのため、Amplify は自動的に静的ホスティング（WEB platform）として認識する
4. Amplify Hosting のコンソールで環境変数を設定する（`.env.local` と同じ内容、4つすべて `VITE_` 付き）:
   - `VITE_COGNITO_USER_POOL_ID`
   - `VITE_COGNITO_USER_POOL_CLIENT_ID`
   - `VITE_AGENT_RUNTIME_ARN`
   - `VITE_AGENT_RUNTIME_REGION`
