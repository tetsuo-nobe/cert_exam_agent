"""認定試験の受験予約に関するツール群。

すべて Strands の @tool として公開する Python 関数として実装する。
- list_venues: 試験会場の一覧を返す（デモ実装: ハードコードされた一覧）
- list_exams: 受験可能な認定試験の一覧を返す（デモ実装: ハードコードされた一覧）
- check_availability: 会場・試験・日時の空き確認（デモ実装: 常に OK）
- get_coupon_discount: クーポンコードから割引率を返す（デモ実装）
- reserve_exam: 予約を確定し、受験予約確認書 PDF を生成して S3 に格納し、署名付き URL を返す
"""

import io
import os
import logging
import uuid
from datetime import datetime, timezone

import boto3
from strands import tool

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

logger = logging.getLogger(__name__)

# 日本語フォント（プロジェクト内の fonts/ に同梱）
_FONT_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "fonts", "NotoSansJP-VariableFont_wght.ttf")
_FONT_NAME = "NotoSansJP"
_FONT_REGISTERED = False

# S3 設定（デプロイ時に環境変数で指定）
_BUCKET_ENV = "EXAM_RESERVATION_BUCKET"
_URL_EXPIRE_SECONDS = 3600  # 署名付き URL の有効期限（秒）

# クーポンコードと割引率の対応表（デモ実装）
_COUPON_TABLE = {
    "ABC": 0.5,   # 50% 割引
    "XYZ": 1.0,   # 100% 割引
}

# 試験会場の一覧（デモ実装: ハードコード）
_VENUES = [
    {"prefecture": "東京", "venue_name": "品川駅前テストセンター"},
    {"prefecture": "大阪", "venue_name": "大阪駅前テストセンター"},
    {"prefecture": "京都", "venue_name": "京都駅前テストセンター"},
]

# 受験可能な認定試験の一覧（デモ実装: ハードコード）
_EXAMS = [
    {"vendor": "AWS", "exam_name": "AWS Certified Cloud Practitioner", "exam_id": "CLF-C02"},
    {"vendor": "AWS", "exam_name": "AWS Certified AI Practitioner", "exam_id": "AIF-C01"},
    {"vendor": "AWS", "exam_name": "AWS Certified Solutions Architect - Associate", "exam_id": "SAA-C03"},
    {"vendor": "AWS", "exam_name": "AWS Certified Developer - Associate", "exam_id": "DVA-C02"},
    {"vendor": "AWS", "exam_name": "AWS Certified CloudOps Engineer - Associate", "exam_id": "SOA-C03"},
    {"vendor": "AWS", "exam_name": "AWS Certified Solutions Architect - Professional", "exam_id": "SAP-C03"},
    {"vendor": "AWS", "exam_name": "AWS Certified DevOps Engineer - Professional", "exam_id": "DOP-C02"},
    {"vendor": "AWS", "exam_name": "AWS Certified Generative AI Developer - Professional", "exam_id": "AIP-C01"},
]


def _ensure_font_registered() -> str:
    """日本語フォントを reportlab に登録する。登録済みのフォント名を返す。"""
    global _FONT_REGISTERED
    if not _FONT_REGISTERED:
        pdfmetrics.registerFont(TTFont(_FONT_NAME, _FONT_PATH))
        _FONT_REGISTERED = True
    return _FONT_NAME


@tool
def list_venues() -> list[dict]:
    """試験会場の一覧を返す。

    Returns:
        各会場の都道府県(prefecture)と会場名(venue_name)を持つ辞書のリスト。
    """
    return _VENUES


@tool
def list_exams() -> list[dict]:
    """受験可能な認定試験の一覧を返す。

    Returns:
        各試験のベンダー(vendor)、認定試験名称(exam_name)、試験ID(exam_id)を持つ辞書のリスト。
    """
    return _EXAMS


@tool
def check_availability(exam_datetime: str, exam_name: str, venue_name: str) -> str:
    """指定した日時・試験・会場に空きがあるかを確認する。

    Args:
        exam_datetime: 受験希望日時（例: "2026-10-01 13:00"）
        exam_name: 試験名（例: "AWS Certified Solutions Architect - Associate"）
        venue_name: 会場名（例: "東京テストセンター"）

    Returns:
        空きがあれば "OK" を返す。
    """
    # デモ実装: 常に空きありとして "OK" を返す
    logger.info("空き確認: datetime=%s, exam=%s, venue=%s", exam_datetime, exam_name, venue_name)
    return "OK"


@tool
def get_coupon_discount(coupon_code: str) -> float:
    """クーポンコードから割引率を返す。

    Args:
        coupon_code: クーポンコード（例: "ABC", "XYZ"）

    Returns:
        割引率を 0.0〜1.0 の小数で返す。50% 割引なら 0.5、100% 割引なら 1.0。
        未知のコードや未指定の場合は 0.0（割引なし）を返す。
    """
    if not coupon_code:
        return 0.0
    rate = _COUPON_TABLE.get(coupon_code.strip().upper(), 0.0)
    logger.info("クーポン割引: code=%s, rate=%s", coupon_code, rate)
    return rate


def _build_reservation_pdf(
    reservation_id: str,
    exam_datetime: str,
    exam_name: str,
    venue_name: str,
    candidate_name: str,
    discount_rate: float,
) -> bytes:
    """受験予約確認書 PDF を生成して bytes で返す。"""
    font_name = _ensure_font_registered()
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    # タイトル
    c.setFont(font_name, 20)
    c.drawCentredString(width / 2, height - 40 * mm, "受験予約確認書")

    # 発行日時
    issued_at = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S")
    c.setFont(font_name, 10)
    c.drawRightString(width - 20 * mm, height - 50 * mm, f"発行日時: {issued_at}")

    # 明細
    discount_percent = int(round(discount_rate * 100))
    rows = [
        ("予約番号", reservation_id),
        ("受験者名", candidate_name),
        ("試験名", exam_name),
        ("受験日時", exam_datetime),
        ("会場名", venue_name),
        ("割引率", f"{discount_percent}%"),
    ]

    y = height - 75 * mm
    c.setFont(font_name, 13)
    for label, value in rows:
        c.drawString(30 * mm, y, f"{label}：")
        c.drawString(75 * mm, y, str(value))
        y -= 12 * mm

    # 区切り線
    c.setLineWidth(0.5)
    c.line(30 * mm, y + 4 * mm, width - 30 * mm, y + 4 * mm)

    # 注意書き
    c.setFont(font_name, 9)
    c.drawString(30 * mm, 25 * mm, "本書は受験予約が確定したことを証明する書類です。当日は本人確認書類をご持参ください。")

    c.showPage()
    c.save()
    buffer.seek(0)
    return buffer.read()


@tool
def reserve_exam(
    exam_datetime: str,
    exam_name: str,
    venue_name: str,
    candidate_name: str,
    discount_rate: float,
) -> str:
    """受験予約を確定し、受験予約確認書 PDF を発行して S3 に格納し、署名付き URL を返す。

    Args:
        exam_datetime: 受験日時（例: "2026-10-01 13:00"）
        exam_name: 試験名
        venue_name: 会場名
        candidate_name: 受験者名（サインインユーザー名）
        discount_rate: 割引率（0.0〜1.0）。get_coupon_discount の戻り値を渡す。

    Returns:
        受験予約確認書 PDF をダウンロードできる S3 の署名付き URL。
    """
    bucket = os.getenv(_BUCKET_ENV)
    if not bucket:
        raise ValueError(
            f"S3 バケットが未設定です。環境変数 {_BUCKET_ENV} に格納先バケット名を設定してください。"
        )

    reservation_id = f"EXAM-{uuid.uuid4().hex[:12].upper()}"
    pdf_bytes = _build_reservation_pdf(
        reservation_id=reservation_id,
        exam_datetime=exam_datetime,
        exam_name=exam_name,
        venue_name=venue_name,
        candidate_name=candidate_name,
        discount_rate=discount_rate,
    )

    region = os.getenv("AWS_REGION")
    s3 = boto3.client("s3", region_name=region) if region else boto3.client("s3")

    key = f"reservations/{reservation_id}.pdf"
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=pdf_bytes,
        ContentType="application/pdf",
        # 署名付き URL のリンクを開いたときにブラウザの新しいタブで直接表示する
        ContentDisposition=f'inline; filename="{reservation_id}.pdf"',
    )
    logger.info("PDF を S3 に格納: s3://%s/%s", bucket, key)

    url = s3.generate_presigned_url(
        ClientMethod="get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=_URL_EXPIRE_SECONDS,
    )
    return url
