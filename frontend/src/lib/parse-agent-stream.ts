// AgentCore Runtime から中継される SSE (text/event-stream) をパースし、
// Bedrock Converse 形式のイベントからテキスト差分・ツール利用状況を取り出すユーティリティ。

interface ConverseStreamEvent {
  event?: {
    contentBlockStart?: {
      contentBlockIndex?: number;
      start?: {
        toolUse?: { toolUseId?: string; name?: string };
      };
    };
    contentBlockStop?: {
      contentBlockIndex?: number;
    };
    contentBlockDelta?: {
      contentBlockIndex?: number;
      delta?: { text?: string };
    };
    messageStop?: {
      stopReason?: string;
    };
  };
  error?: string;
}

export type AgentStreamEvent =
  | { type: "text"; text: string }
  | { type: "toolStart"; name: string }
  | { type: "toolStop" }
  | { type: "messageStop"; stopReason: string };

/**
 * ReadableStream (SSE) を読み進めながら、パースしたイベントが来るたびに onEvent を呼ぶ。
 * `data: {...}\n\n` 形式の行をパースする。
 */
export async function consumeAgentEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: AgentStreamEvent) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // contentBlockIndex -> ツール実行中かどうか(テキストブロックには contentBlockStart が来ないため
  // ここに記録されているインデックスは常にツール呼び出しブロック)
  const openToolBlocks = new Set<number>();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      // 最後の要素は不完全な可能性があるのでバッファに戻す
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const jsonStr = line.slice("data:".length).trim();
        if (!jsonStr) continue;

        let parsed: ConverseStreamEvent;
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        if (parsed.error) {
          throw new Error(parsed.error);
        }

        const ev = parsed.event;
        if (!ev) continue;

        const toolUse = ev.contentBlockStart?.start?.toolUse;
        if (toolUse?.name) {
          const index = ev.contentBlockStart?.contentBlockIndex;
          if (typeof index === "number") openToolBlocks.add(index);
          onEvent({ type: "toolStart", name: toolUse.name });
          continue;
        }

        const stopIndex = ev.contentBlockStop?.contentBlockIndex;
        if (typeof stopIndex === "number" && openToolBlocks.has(stopIndex)) {
          openToolBlocks.delete(stopIndex);
          onEvent({ type: "toolStop" });
          continue;
        }

        const text = ev.contentBlockDelta?.delta?.text;
        if (text) {
          onEvent({ type: "text", text });
          continue;
        }

        const stopReason = ev.messageStop?.stopReason;
        if (stopReason) {
          onEvent({ type: "messageStop", stopReason });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
