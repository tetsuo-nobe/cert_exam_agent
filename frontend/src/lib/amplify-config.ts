import type { ResourcesConfig } from "aws-amplify";

// バックエンド(SAM)の Outputs から取得した値。ビルド時に埋め込まれるため NEXT_PUBLIC_ プレフィックスが必要。
const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID;

if (!userPoolId || !userPoolClientId) {
  throw new Error(
    "NEXT_PUBLIC_COGNITO_USER_POOL_ID と NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID を .env.local に設定してください。"
  );
}

// Amplify UI + SRP 認証のみを使う構成。Hosted UI / OAuth は使用しない。
export const amplifyConfig: ResourcesConfig = {
  Auth: {
    Cognito: {
      userPoolId,
      userPoolClientId,
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
