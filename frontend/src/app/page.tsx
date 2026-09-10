"use client";

import { useState, useRef, useCallback } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { fetchAuthSession } from "aws-amplify/auth";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./page.module.css";
import { consumeAgentEventStream } from "@/lib/parse-agent-stream";
import { invokeAgent } from "@/lib/agent-client";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  // アシスタントの返信がストリーミング中かどうか。
  // true の間は生テキストのまま表示し、完了後に Markdown としてレンダリングする。
  isStreaming?: boolean;
  // このメッセージの生成中に呼び出されたツールの一覧(表示用ラベル)。
  toolCalls?: { label: string; done: boolean }[];
}

// エージェントのツール名 → チャットに表示するわかりやすい日本語ラベル
const TOOL_LABELS: Record<string, string> = {
  check_availability: "空き状況を確認しています",
  get_coupon_discount: "クーポンの割引率を確認しています",
  reserve_exam: "受験予約を確定し、確認書を発行しています",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `${name} を実行しています`;
}

// PDFの署名付きURLなど、外部リンクは新しいタブで開く
function MarkdownLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export default function ChatPage() {
  const { signOut, user } = useAuthenticator((context) => [context.user]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string>(crypto.randomUUID());

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const prompt = input.trim();
      if (!prompt || isSending) return;

      setError(null);
      setMessages((prev) => [...prev, { role: "user", text: prompt }]);
      setInput("");
      setIsSending(true);

      try {
        const session = await fetchAuthSession();
        const idToken = session.tokens?.idToken?.toString();
        if (!idToken) {
          throw new Error("認証トークンが取得できませんでした。再度サインインしてください。");
        }

        const stream = await invokeAgent(idToken, prompt, sessionIdRef.current);

        // アシスタントの返信用のメッセージを先に追加(ストリーミング中フラグを立てる)し、
        // 以降はテキストとツール利用状況を追記していく
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: "", isStreaming: true, toolCalls: [] },
        ]);

        await consumeAgentEventStream(stream, (event) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (!last || last.role !== "assistant") return next;

            if (event.type === "text") {
              next[next.length - 1] = { ...last, text: last.text + event.text };
            } else if (event.type === "toolStart") {
              const toolCalls = [...(last.toolCalls ?? []), { label: toolLabel(event.name), done: false }];
              next[next.length - 1] = { ...last, toolCalls };
            } else if (event.type === "toolStop") {
              const toolCalls = (last.toolCalls ?? []).map((t, i) =>
                i === (last.toolCalls?.length ?? 0) - 1 ? { ...t, done: true } : t
              );
              next[next.length - 1] = { ...last, toolCalls };
            }
            return next;
          });
        });

        // ストリーム完了。Markdown としてレンダリングするためフラグを下ろす
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { ...last, isStreaming: false };
          }
          return next;
        });
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsSending(false);
      }
    },
    [input, isSending]
  );

  const candidateName = user?.signInDetails?.loginId ?? user?.username ?? "";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.title}>認定試験 受験予約エージェント</span>
        <button className={styles.signOutButton} onClick={signOut}>
          サインアウト{candidateName ? `（${candidateName}）` : ""}
        </button>
      </header>

      {error && <div className={styles.errorBanner}>{error}</div>}

      <div className={styles.messages}>
        {messages.length === 0 && (
          <p style={{ color: "#888" }}>
            受験日時・試験名・会場名・クーポンコード（任意）を伝えて、受験予約を進めてください。
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`${styles.messageRow} ${
              m.role === "user" ? styles.messageRowUser : styles.messageRowAssistant
            }`}
          >
            <div
              className={`${styles.bubble} ${
                m.role === "user" ? styles.bubbleUser : styles.bubbleAssistant
              }`}
            >
              {m.toolCalls && m.toolCalls.length > 0 && (
                <div className={styles.toolCalls}>
                  {m.toolCalls.map((t, ti) => (
                    <div key={ti} className={styles.toolCallItem}>
                      <span
                        className={`${styles.toolCallStatus} ${
                          t.done ? styles.toolCallStatusDone : styles.toolCallStatusRunning
                        }`}
                      />
                      {t.label}
                      {t.done ? "（完了）" : "..."}
                    </div>
                  ))}
                </div>
              )}
              {m.role === "assistant" && !m.isStreaming ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{ a: MarkdownLink }}
                >
                  {m.text}
                </ReactMarkdown>
              ) : (
                m.text
              )}
            </div>
          </div>
        ))}
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="例: 2026年10月1日13時にAWS SAAを東京テストセンターで受験したいです"
          disabled={isSending}
        />
        <button className={styles.sendButton} type="submit" disabled={isSending || !input.trim()}>
          {isSending ? "送信中..." : "送信"}
        </button>
      </form>
    </div>
  );
}
