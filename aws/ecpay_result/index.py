import base64, os, urllib.parse

SITE = os.environ.get("SITE_URL", "https://fare-finder-pro-topaz.vercel.app").rstrip("/")


def handler(event, context):
    """OrderResultURL - ECPay returns the browser with a POST; a static SPA would 405, so redirect.
    UX only: activation happens in the ReturnURL callback, never here."""
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8", "replace")
    p = {k: v[0] for k, v in urllib.parse.parse_qs(raw, keep_blank_values=True).items()}
    outcome = "success" if p.get("RtnCode", "1") == "1" else "failed"
    print("order result", p.get("MerchantTradeNo"), p.get("RtnCode"), p.get("RtnMsg"))
    return {"statusCode": 302, "headers": {"Location": f"{SITE}/app?purchase={outcome}"}, "body": ""}
