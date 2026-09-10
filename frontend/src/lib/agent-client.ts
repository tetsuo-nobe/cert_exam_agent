// ブラウザから AgentCore Runtime の /invocations エンドポイントへ直接アクセスするクライアント。
//
// AgentCore Runtime は Access-Control-Allow-Origin: * を返す(検証済み)ため、
// サーバー側プロキシを介さずブラウザから直接呼び出せる。
// Next.js は静的サイト(output: "export")としてビルドされ、Amplify Hosting は
// 静的ホスティングとしてこのアプリを配信する(SSR compute のストリーミング未対応を回避)。
//
// AgentCore Runtime の ARN・リージョンはビルド時に NEXT_PUBLIC_* としてブラウザに埋め込まれるが、
// 呼び出しには Cognito が発行した JWT (Inbound Auth で aud クレームを検証) が必須なため、
// ARN 自体を知られても呼び出しはできない。

const AGENT_RUNTIME_ARN = process.env.NEXT_PUBLIC_AGENT_RUNTIME_ARN;
const AWS_REGION = process.env.NEXT_PUBLIC_AGENT_RUNTIME_REGION ?? "us-east-1";

export const isAgentClientConfigured = Boolean(AGENT_RUNTIME_ARN);

function buildInvocationUrl(): string {
  if (!AGENT_RUNTIME_ARN) {
    throw new Error(
      "環境変数 NEXT_PUBLIC_AGENT_RUNTIME_ARN が設定されていません。"
    );
  }
  const escapedArn = encodeURIComponent(AGENT_RUNTIME_ARN);
  return `https://bedrock-agentcore.${AWS_REGION}.amazonaws.com/runtimes/${escapedArn}/invocations?qualifier=DEFAULT`;
}

// AgentCore Runtime のセッションIDは十分な長さが必要なため、短い session id を安全な長さに正規化する。
function normalizeSessionId(sessionId: string): string {
  return sessionId.length >= 33 ? sessionId : `${sessionId}-${crypto.randomUUID()}`;
}

/**
 * AgentCore Runtime にプロンプトを送信し、SSE (text/event-stream) の ReadableStream を返す。
 * 呼び出し元は parse-agent-stream.ts の consumeAgentEventStream でパースする。
 */
export async function invokeAgent(
  idToken: string,
  prompt: string,
  sessionId: string
): Promise<ReadableStream<Uint8Array>> {
  const url = buildInvocationUrl();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": normalizeSessionId(sessionId),
    },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`エージェント呼び出しエラー (${res.status})${text ? `: ${text}` : ""}`);
  }

  return res.body;
}
