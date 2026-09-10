import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ブラウザから AgentCore Runtime を直接呼び出す構成のため、
  // サーバー機能(SSR/API Routes)を使わない静的サイトとしてビルドする。
  // Amplify Hosting の SSR compute はストリーミングレスポンスを未サポートのため、これを回避する。
  output: "export",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
