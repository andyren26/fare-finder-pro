import json, time, html, urllib.request, urllib.error
import boto3
from botocore.exceptions import ClientError

UA = "Mozilla/5.0 (compatible; flight-notifier/1.0)"
CITY = {"TPE": "台北", "TYO": "東京", "SEL": "首爾", "LON": "倫敦"}
SITE = "https://fare-finder-pro-topaz.vercel.app"
_sm = boto3.client("secretsmanager")
_tbl = boto3.resource("dynamodb").Table("subscriptions")
_cfg = {}


class Transient(Exception):
    pass


def secret(name):
    if name not in _cfg:
        _cfg[name] = json.loads(_sm.get_secret_value(SecretId=name)["SecretString"])
    return _cfg[name]


def title(route):
    o, d = route.split("-")
    return f"{CITY.get(o, o)} → {CITY.get(d, d)}"


def render(msg, row):
    t, e = title(msg["route"]), html.escape
    amount = f"NT${int(secret('flight/ecpay').get('amount', 300)):,}"
    end = msg.get("current_period_end_date") or row.get("current_period_end_date") or ""
    target = f"NT${int(row['target_price']):,}" if row.get("target_price") is not None else ""
    if msg["event_type"] == "welcome":
        subject = f"✅ 訂閱成功：{t} 降價通知已開通"
        lines = [f"感謝訂閱 Flight Price Notifier！{t} 的降價通知已經開通。",
                 f"方案：每月 {amount}（信用卡定期定額，隨時可取消）",
                 f"目標價：{target}" if target else "",
                 f"本期有效至：{end}" if end else "",
                 "票價一低於你的目標價，我們就會寄信通知你。"]
    else:
        subject = f"已取消訂閱：{t} 降價通知"
        lines = [f"你已取消 {t} 的降價通知訂閱，之後不會再扣款。",
                 f"你已付款的這一期仍然有效，到 {end} 為止我們會繼續寄降價通知給你。" if end else "",
                 "想再回來，隨時到網站重新訂閱就可以了。"]
    lines = [l for l in lines if l]
    body_html = ('<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;'
                 'margin:0 auto;color:#111">' + "".join(f'<p style="margin:0 0 12px;font-size:15px">{e(l)}</p>'
                                                       for l in lines)
                 + f'<p style="margin:24px 0"><a href="{SITE}/app" style="background:#0b63ce;color:#fff;'
                   'text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;display:inline-block">'
                   '管理我的訂閱</a></p></div>')
    return subject, body_html, "\n\n".join(lines + [f"管理我的訂閱：{SITE}/app"])


def claim(msg):
    """Once-only guard: mark this event as sent on the row; False if it was already sent."""
    attr = "welcome_sent_for" if msg["event_type"] == "welcome" else "cancel_sent_for"
    tag = msg.get("merchant_trade_no") or "-"
    try:
        _tbl.update_item(Key={"email": msg["email"], "route": msg["route"]},
                         UpdateExpression=f"SET {attr} = :t",
                         ConditionExpression=f"attribute_not_exists({attr}) OR {attr} <> :t",
                         ExpressionAttributeValues={":t": tag})
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise


def release(msg):
    attr = "welcome_sent_for" if msg["event_type"] == "welcome" else "cancel_sent_for"
    _tbl.update_item(Key={"email": msg["email"], "route": msg["route"]}, UpdateExpression=f"REMOVE {attr}")


def send(msg):
    if msg.get("event_type") not in ("welcome", "cancel"):
        print("unknown event_type, dropping", msg)
        return
    row = _tbl.get_item(Key={"email": msg["email"], "route": msg["route"]}).get("Item") or {}
    if not claim(msg):
        print("already sent", msg["event_type"], msg["email"], msg["route"])
        return
    subject, body_html, body_text = render(msg, row)
    c = secret("flight/resend")
    req = urllib.request.Request("https://api.resend.com/emails", method="POST",
                                 data=json.dumps({"from": c["from"], "to": [msg["email"]], "subject": subject,
                                                  "html": body_html, "text": body_text}).encode(),
                                 headers={"Authorization": "Bearer " + c["api_key"],
                                          "Content-Type": "application/json", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            print("SENT", msg["event_type"], msg["email"], msg["route"], r.read().decode()[:200])
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="ignore")[:300]
        if e.code == 429 or e.code >= 500:
            release(msg)
            raise Transient(f"resend {e.code} {detail}")
        print("RESEND_DROP", e.code, msg["email"], detail)  # 403/422 are permanent: don't loop
    except (urllib.error.URLError, TimeoutError) as e:
        release(msg)
        raise Transient(f"resend network {e!r}")


def handler(event, context):
    failures = []
    for rec in event.get("Records", []):
        try:
            send(json.loads(rec["body"]))
        except Transient as e:
            print("TRANSIENT", e)
            failures.append({"itemIdentifier": rec["messageId"]})
        except Exception as e:
            print("ERROR dropping message", repr(e), rec.get("body", "")[:300])
    return {"batchItemFailures": failures}
