from typing import Any, Optional
from collections import OrderedDict
import jwt
from strands import Agent, tool
import asyncio
from strands.agent.conversation_manager.null_conversation_manager import NullConversationManager
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from model.load import load_model
from memory.session import get_memory_session_manager
from skills.reservation import (
    list_venues,
    list_exams,
    check_availability,
    get_coupon_discount,
    reserve_exam,
)

app = BedrockAgentCoreApp()
log = app.logger

# 受験予約エージェントのシステムプロンプト
DEFAULT_SYSTEM_PROMPT = """
あなたは認定試験の受験予約を代行するアシスタントです。日本語で丁寧に応対してください。

# 役割
ユーザーから「受験日時」「試験名」「会場名」「クーポンコード」を聞き取り、認定試験の受験予約を行います。
受験者名は必ずシステムから渡されるサインインユーザー名（受験者名: の後に記載）を使用します。ユーザーに受験者名を尋ねてはいけません。

# 会場・試験の案内
- ユーザーが会場を尋ねてきたり、会場の選択に迷っている場合は、list_venues ツールで会場一覧を取得して案内する。
- ユーザーが試験を尋ねてきたり、試験の選択に迷っている場合は、list_exams ツールで受験可能な試験一覧を取得して案内する。
- ユーザーが指定した会場名・試験名が一覧に無い場合は、一覧から候補を示して確認を促す。

# 予約の手順（必ずこの順序でツールを使用すること）
1. 受験日時・試験名・会場名がそろったら、check_availability ツールで空きを確認する。
   戻り値が "OK" でなければ予約を進めない。
2. クーポンコードが提示された場合は、get_coupon_discount ツールで割引率を取得する。
   クーポンが無い場合は割引率 0.0 とする。
3. check_availability が OK で必要情報がそろったら、reserve_exam ツールを呼び出す。
   candidate_name にはサインインユーザー名を、discount_rate には手順2で得た割引率を渡す。
4. reserve_exam が返した署名付き URL を、受験予約確認書 PDF のダウンロードリンクとしてユーザーに案内する。

# 注意
- 必要な情報（受験日時・試験名・会場名）が不足している場合は、予約を進める前にユーザーに質問して確認する。
- 割引率はユーザーには「50%割引」のようにわかりやすく伝える。
"""


# モデルが使用するツール群
tools = [
    list_venues,
    list_exams,
    check_availability,
    get_coupon_discount,
    reserve_exam,
]

_INLINE_FUNCTION_NAMES = set()


def _make_conversation_manager():
    return NullConversationManager()

def agent_factory():
    cache = {}
    def get_or_create_agent(session_id, user_id):
        _actor_id = user_id
        key = f"{session_id}/{_actor_id}"
        if key not in cache:
            cache[key] = Agent(
                model=load_model(),
                session_manager=get_memory_session_manager(session_id, _actor_id),
                conversation_manager=_make_conversation_manager(),
                system_prompt=DEFAULT_SYSTEM_PROMPT,
                tools=tools,
                hooks=[
                ],
            )
        return cache[key]
    return get_or_create_agent
get_or_create_agent = agent_factory()


def strip_trailing_tool_use(messages: Any) -> list[dict]:
    """Strip toolUse blocks from the tail until the last message has none."""
    if not isinstance(messages, list):
        raise ValueError("messages must be a list")

    messages = list(messages)
    while messages:
        last = messages[-1]
        if not isinstance(last, dict):
            raise ValueError("each message must be an object")
        original_content = last.get("content", [])
        if not isinstance(original_content, list) or not all(isinstance(block, dict) for block in original_content):
            raise ValueError("each message content value must be a list of content blocks")

        content = [block for block in original_content if "toolUse" not in block]
        if len(content) == len(original_content):
            break
        if content:
            messages[-1] = {**last, "content": content}
            break
        messages.pop()

    return messages


def _extract_prompt(payload: dict):
    """Accept validated harness messages, tool results, or a plain prompt string."""
    if not isinstance(payload, dict):
        raise ValueError("payload must be a JSON object")
    if "messages" in payload:
        return strip_trailing_tool_use(payload["messages"])
    if "tool_results" in payload:
        tool_results = payload["tool_results"]
        if not isinstance(tool_results, list) or not all(
            isinstance(tool_result, dict) and isinstance(tool_result.get("toolUseId"), str)
            for tool_result in tool_results
        ):
            raise ValueError("tool_results must contain objects with a toolUseId string")
        return [{"role": "user", "content": [{"toolResult": {
            "toolUseId": tr["toolUseId"],
            "status": tr.get("status", "success"),
            "content": tr.get("content", []),
        }} for tr in tool_results]}]
    prompt = payload.get("prompt", "")
    if not isinstance(prompt, str):
        raise ValueError("prompt must be a string")
    return prompt


def _has_inline_function_call(messages) -> bool:
    """Return True if messages contains an assistant toolUse for an inline function tool."""
    if not _INLINE_FUNCTION_NAMES or not isinstance(messages, list):
        return False
    for msg in messages:
        if msg.get("role") == "assistant":
            for block in msg.get("content", []):
                if isinstance(block, dict) and block.get("toolUse", {}).get("name") in _INLINE_FUNCTION_NAMES:
                    return True
    return False


def _is_inline_function_call(event: dict) -> bool:
    """Check if a contentBlockStart event is for an inline function tool."""
    if not _INLINE_FUNCTION_NAMES:
        return False
    cbs = event.get("contentBlockStart", {})
    start = cbs.get("start", {})
    tool_use = start.get("toolUse") if isinstance(start, dict) else None
    return tool_use is not None and tool_use.get("name") in _INLINE_FUNCTION_NAMES



def _get_jwt_claims(context) -> dict:
    """context の Authorization ヘッダーから JWT のクレームを取り出す。

    AgentCore Runtime の Inbound Auth(CUSTOM_JWT) がトークンの署名・有効期限を
    検証済みでエントリポイントに渡してくるため、ここでは再検証せずクレームを読むだけでよい。
    """
    headers = getattr(context, "request_headers", None) or {}
    auth_header = headers.get("Authorization") or headers.get("authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return {}
    token = auth_header[len("Bearer "):]
    try:
        return jwt.decode(token, options={"verify_signature": False})
    except jwt.exceptions.DecodeError:
        log.warning("Authorization ヘッダーの JWT デコードに失敗しました")
        return {}


def _resolve_user_id(claims: dict) -> str:
    """メモリセッションの actor_id として使うユーザー識別子を解決する（Cognito の sub クレーム）。"""
    sub = claims.get("sub")
    if isinstance(sub, str) and sub.strip():
        return sub.strip()
    return "default-user"


def _resolve_candidate_name(payload, claims: dict, user_id: str) -> str:
    """受験者名（サインインユーザー名）を解決する。

    優先順位: Cognito の name クレーム（サインアップ時の表示名） > payload の user_name/candidate_name > user_id。
    """
    name_claim = claims.get("name")
    if isinstance(name_claim, str) and name_claim.strip():
        return name_claim.strip()
    if isinstance(payload, dict):
        for key in ("user_name", "candidate_name", "username"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    if user_id and user_id != "default-user":
        return user_id
    return "ゲストユーザー"


def _inject_candidate_name(prompt, candidate_name: str):
    """受験者名の情報をプロンプト先頭に注入する。

    プロンプトが文字列でもメッセージリストでも対応する。
    """
    note = f"[システム情報] 受験者名: {candidate_name}"
    if isinstance(prompt, str):
        return f"{note}\n\n{prompt}"
    if isinstance(prompt, list):
        return [{"role": "user", "content": [{"text": note}]}, *prompt]
    return prompt


@app.entrypoint
async def invoke(payload, context):
    log.info("Invoking Agent.....")


    session_id = getattr(context, 'session_id', 'default-session')
    claims = _get_jwt_claims(context)
    user_id = _resolve_user_id(claims)
    agent = get_or_create_agent(session_id, user_id)

    candidate_name = _resolve_candidate_name(payload, claims, user_id)
    prompt = _inject_candidate_name(_extract_prompt(payload), candidate_name)


    async for event in agent.stream_async(
        prompt,
    ):
        if not isinstance(event, dict) or "event" not in event:
            continue
        cbs = event["event"].get("contentBlockStart")
        if cbs is not None and not cbs.get("start"):
            continue
        yield event


if __name__ == "__main__":
    app.run()
