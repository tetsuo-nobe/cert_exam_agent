import { NextRequest } from "next/server";

// このAPI Routeはサーバー側でのみ実行される（Node.js runtime）。
// ブラウザからは同一オリジンのこのエンドポイントだけを呼び、
// AgentCore RuntimeのARN・リージョン・JWTはブラウザに露出させない。
export const runtime = "nodejs";

const AGENT_RUNTIME_ARN = process.env.AGENT_RUNTIME_ARN;
const AWS_REGION = process.env.AGENT_RUNTIME_REGION ?? "us-east-1";

interface InvokeRequestBody {
  prompt: string;
  sessionId?: string;
}

function buildInvocationUrl(): string {
  if (!AGENT_RUNTIME_ARN) {
    throw new Error("環境変数 AGENT_RUNTIME_ARN が設定されていません。");
  }
  const escapedArn = encodeURIComponent(AGENT_RUNTIME_ARN);
  return `https://bedrock-agentcore.${AWS_REGION}.amazonaws.com/runtimes/${escapedArn}/invocations?qualifier=DEFAULT`;
}

// AgentCore Runtime のセッションIDは十分な長さが必要なため、
// ブラウザから受け取った短い session id を安全な長さに正規化する。
function normalizeSessionId(sessionId: string | undefined): string {
  const base = sessionId && sessionId.trim().length > 0 ? sessionId.trim() : crypto.randomUUID();
  return base.length >= 33 ? base : `${base}-${crypto.randomUUID()}`;
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "認証情報がありません。再度サインインしてください。" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: InvokeRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "リクエストの形式が正しくありません。" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.prompt || typeof body.prompt !== "string") {
    return new Response(JSON.stringify({ error: "prompt は必須です。" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let invocationUrl: string;
  try {
    invocationUrl = buildInvocationUrl();
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sessionId = normalizeSessionId(body.sessionId);

  let upstream: Response;
  try {
    upstream = await fetch(invocationUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId,
      },
      body: JSON.stringify({ prompt: body.prompt }),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `エージェントの呼び出しに失敗しました: ${(err as Error).message}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(
      JSON.stringify({ error: `エージェント呼び出しエラー (${upstream.status})`, detail: text }),
      { status: upstream.status || 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // AgentCore Runtime からの SSE (text/event-stream) をそのままブラウザへ中継する。
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Session-Id": sessionId,
    },
  });
}
