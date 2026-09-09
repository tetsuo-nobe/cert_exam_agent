import type { ResourcesConfig } from "aws-amplify";

// バックエンド(SAM)の Outputs から取得した値。ビルド時に埋め込まれるため NEXT_PUBLIC_ プレフィックスが必要。
const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID;

// 環境変数が設定されているかどうか。
// ここでは throw しない: モジュール読み込み時の throw は Next.js のビルド時静的プリレンダリングでも
// 実行されてしまい、ビルド自体を失敗させる。未設定の場合は呼び出し側(providers.tsx)で
// 画面にエラーメッセージを表示する。
export const isAmplifyConfigured = Boolean(userPoolId && userPoolClientId);

// Amplify UI + SRP 認証のみを使う構成。Hosted UI / OAuth は使用しない。
export const amplifyConfig: ResourcesConfig = {
  Auth: {
    Cognito: {
      userPoolId: userPoolId ?? "",
      userPoolClientId: userPoolClientId ?? "",
      signUpVerificationMethod: "code",
      userAttributes: {
        // サインアップ時に受験者名(name)の入力を必須にする
        name: {
          required: true,
        },
      },
    },
  },
};
