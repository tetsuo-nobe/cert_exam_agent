"use client";

import { Amplify } from "aws-amplify";
import {
  Authenticator,
  Heading,
  useTheme,
  View,
  Image,
} from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { amplifyConfig, isAmplifyConfigured } from "@/lib/amplify-config";

if (isAmplifyConfigured) {
  Amplify.configure(amplifyConfig, { ssr: true });
}

// サインイン/サインアップ画面のヘッダー（Amplify UI コンポーネントのカスタマイズ）
function AuthHeader() {
  const { tokens } = useTheme();
  return (
    <View textAlign="center" padding={tokens.space.large}>
      <Image alt="認定試験受験予約" src="/next.svg" width="120px" />
      <Heading level={4} marginTop={tokens.space.medium}>
        認定試験 受験予約
      </Heading>
    </View>
  );
}

const formFields = {
  signUp: {
    name: {
      label: "受験者名（表示名）",
      placeholder: "山田 太郎",
      order: 1,
      isRequired: true,
    },
    email: {
      order: 2,
    },
    password: {
      order: 3,
    },
    confirm_password: {
      order: 4,
    },
  },
};

// Authenticator でラップするだけの Provider。サインイン後の UI は各ページ側で
// useAuthenticator フックを使って組み立てる。
export default function Providers({ children }: { children: React.ReactNode }) {
  if (!isAmplifyConfigured) {
    return (
      <View padding="2rem" textAlign="center">
        <Heading level={4}>設定エラー</Heading>
        <p>
          NEXT_PUBLIC_COGNITO_USER_POOL_ID と NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID
          が設定されていません。デプロイ環境の環境変数を確認してください。
        </p>
      </View>
    );
  }

  return (
    <Authenticator formFields={formFields} components={{ Header: AuthHeader }}>
      {children}
    </Authenticator>
  );
}
