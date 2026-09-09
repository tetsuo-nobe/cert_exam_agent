# 認定試験 受験予約エージェント (cert_exam_agent)

認定試験の受験予約を、チャットで行える AI エージェントアプリケーションです。ユーザーはサインインして、
「受験日時・試験名・会場名・クーポンコード」をチャットで伝えるだけで受験予約が完了し、受験予約確認書
PDF をダウンロードできます。

## 全体構成

このリポジトリは3つのサブプロジェクトからなるモノリポです。

```
cert_exam_agent/
├── backend/     ... AWS SAM: 認証(Cognito) と PDF格納用 S3 バケットを構築
├── examAgent/   ... Amazon Bedrock AgentCore Runtime 上で動く Strands Agent(エージェント本体)
├── frontend/    ... Next.js: サインインしてエージェントとチャットする Web UI
└── amplify.yml  ... frontend を AWS Amplify Hosting にモノリポとしてデプロイするためのビルド設定
```

### 全体の関連図

```mermaid
flowchart TD
    User["ユーザー(ブラウザ)"]
    Frontend["frontend (Next.js)<br/>Authenticator (SRP)"]
    Cognito["Cognito User Pool<br/>(backend/template.yaml)"]
    ApiRoute["Next.js API Route<br/>/api/agent/invoke<br/>(サーバー側でIDトークンを中継)"]
    Runtime["AgentCore Runtime<br/>(examAgent/app/MyAgent)<br/>Inbound Auth: JWT"]
    ToolCheck["check_availability<br/>空き確認 (デモ: 常にOK)"]
    ToolCoupon["get_coupon_discount<br/>割引率取得 (デモ: ABC=50%, XYZ=100%)"]
    ToolReserve["reserve_exam<br/>予約確定 + PDF生成"]
    S3["S3 バケット<br/>(backend/template.yaml)<br/>受験予約確認書PDF"]

    User -->|サインイン| Frontend
    Frontend <-->|SRP認証・IDトークン発行| Cognito
    Frontend -->|Authorization: Bearer IDトークン| ApiRoute
    ApiRoute -->|JWT転送| Runtime
    Runtime -->|IDトークンのnameクレーム=受験者名| Runtime
    Runtime --> ToolCheck
    Runtime --> ToolCoupon
    Runtime --> ToolReserve
    ToolReserve -->|PutObject / 署名付きURL発行| S3
    S3 -.->|署名付きURL経由でPDF表示| User
```

3つのサブプロジェクトは互いに直接参照し合わず、**設定値（バケット名、Cognito の ID など）を介して
結び付いて**います。それぞれのデプロイ・設定手順は各フォルダの README を参照してください。

## サブプロジェクトの役割

### backend/ — AWS SAM (認証・ストレージ基盤)

`backend/template.yaml` が定義する、エージェントとフロントエンドの両方が使う基盤リソースです。

- **S3 バケット**: エージェントが生成する受験予約確認書 PDF の格納先。パブリックアクセスは禁止し、
  ダウンロードは署名付き URL 経由のみ。一定期間後に自動削除。
- **Cognito User Pool / User Pool Client**: フロントエンドのサインイン用。メールアドレスでサインイン
  し、`name`属性（受験者名）の入力を必須にしている。認証方式は Amplify UI + SRP（Hosted UI は使わない）。
- **IAM Managed Policy**: エージェントの実行ロールに付与する、S3 バケットへの `PutObject`/`GetObject`
  権限。

`backend` の SAM デプロイで得られる Outputs（バケット名、Cognito の User Pool ID / Client ID /
discovery URL、ポリシー ARN）が、`examAgent` と `frontend` の設定値として使われます。

詳細は [`backend/README.md`](./backend/README.md) を参照してください。

### examAgent/ — AgentCore Runtime (エージェント本体)

Amazon Bedrock AgentCore Runtime 上で動く Strands Agent です。`agentcore` CLI で作成・デプロイされた
プロジェクトで、エントリポイントは `examAgent/app/MyAgent/main.py` です。

- **受験者名の解決**: サインインユーザーの Cognito ID トークン（`Authorization` ヘッダー経由でエージ
  ェントに転送される）から `name` クレームを読み取り、受験者名として使用する。ユーザーに名前を聞かない。
- **3つのツール**（`app/MyAgent/skills/reservation.py`）:
  - `check_availability` — 日時・試験名・会場名から空きを確認（デモ実装: 常に `OK`）
  - `get_coupon_discount` — クーポンコードから割引率を返す（デモ実装: `ABC`→50%, `XYZ`→100%）
  - `reserve_exam` — 予約を確定し、日本語フォント埋め込みの PDF を生成して S3 に格納、署名付き URL
    を返す
- **AgentCore Memory**: セッションごとの会話履行を保持する。
- **Inbound Auth (CUSTOM_JWT)**: `backend` で作成した Cognito の discovery URL / audience を使い、
  JWT（ID トークン）を検証する。`agentcore/agentcore.json` に設定されている。

詳細は [`examAgent/README.md`](./examAgent/README.md) と [`examAgent/AGENTS.md`](./examAgent/AGENTS.md)
を参照してください。

### frontend/ — Next.js (Web UI)

サインインしてエージェントとチャットするための Web アプリケーションです。

- **認証**: `@aws-amplify/ui-react` の `Authenticator` コンポーネントで、SRP 認証によりサインイン/
  サインアップを行う（Cognito Hosted UI は使わない）。サインアップ時に受験者名（`name`属性）の入力を
  必須にしている。
- **チャット UI**: エージェントの応答を SSE (Server-Sent Events) でストリーミング表示する。ツール呼び
  出し中は「空き状況を確認しています...」のように状況を表示し、完了後は Markdown を HTML に変換して
  表示する。受験予約確認書 PDF の署名付き URL はクリックすると新しいタブで直接開く。
- **API Route (`/api/agent/invoke`)**: サーバー側でのみ実行され、ブラウザの ID トークンを
  AgentCore Runtime の `/invocations` エンドポイントに中継する。AgentCore Runtime の ARN や
  リージョンはブラウザに一切露出しない。

詳細は [`frontend/README.md`](./frontend/README.md) を参照してください。

## デプロイの順序

各サブプロジェクトは設定値を介して依存しているため、次の順序でデプロイします。

1. **backend** をデプロイし、S3 バケット名・Cognito の User Pool ID / Client ID / discovery URL・
   IAM ポリシー ARN を取得する（`sam deploy --guided`）。
2. **examAgent** の `agentcore/agentcore.json` に、1 で取得した値（バケット名を環境変数
   `EXAM_RESERVATION_BUCKET` に、Cognito の discovery URL / audience を Inbound Auth に、IAM ポリシー
   ARN を `additionalPolicies` に）を設定し、`agentcore deploy` でエージェントをデプロイする。
3. **frontend** の環境変数（`.env.local`、Amplify Hosting ではコンソールの環境変数）に、1 で取得した
   Cognito の値と、2 で取得した AgentCore Runtime の ARN・リージョンを設定してデプロイする
   （`amplify.yml` を使ったモノリポ構成、`appRoot: frontend`）。

## 技術スタック

| サブプロジェクト | 主な技術 |
| --- | --- |
| backend | AWS SAM, Amazon Cognito, Amazon S3, IAM |
| examAgent | Amazon Bedrock AgentCore Runtime, Strands Agents SDK (Python), AgentCore Memory, reportlab (PDF生成) |
| frontend | Next.js (App Router) + TypeScript, aws-amplify / @aws-amplify/ui-react, react-markdown |
