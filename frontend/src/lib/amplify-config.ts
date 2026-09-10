import type { ResourcesConfig } from "aws-amplify";

// バックエンド(SAM)の Outputs から取得した値。ビルド時に埋め込まれるため VITE_ プレフィックスが必要。
const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
const userPoolClientId = import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID;

// 環境変数が設定されているかどうか。未設定の場合は呼び出し側(App.tsx)で画面にエラーメッセージを表示する。
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
