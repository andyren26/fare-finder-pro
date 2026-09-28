import boto3, json, time, hashlib, html, secrets, urllib.parse
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

PLANS = {"tokyo": {"origin": "TPE", "destination": "TYO", "name": "台北-東京"},
         "seoul": {"origin": "TPE", "destination": "SEL", "name": "台北-首爾"},
         "london": {"origin": "TPE", "destination": "LON", "name": "台北-倫敦"}}
API = "https://rpb93lyjzd.execute-api.us-east-1.amazonaws.com"
# Monthly in production. To test renewals next day: PERIOD = ("D", 1, 2), then revert.
PERIOD = ("M", 1, 999)
ddb = boto3.resource("dynamodb").Table("subscriptions")
_sm = boto3.client("secretsmanager")
_cfg = None


def cfg():
    global _cfg
    if _cfg is None:
        _cfg = json.loads(_sm.get_secret_value(SecretId="flight/ecpay")["SecretString"])
    return _cfg


def ecpay_url_encode(s):
    e = urllib.parse.quote_plus(str(s)).replace("~", "%7E").lower()
    for o, n in (("%2d", "-"), ("%5f", "_"), ("%2e", "."), ("%21", "!"), ("%2a", "*"), ("%28", "("), ("%29", ")")):
        e = e.replace(o, n)
    return e


def gen_cmv(params, key, iv):
    items = {k: v for k, v in params.items() if k != "CheckMacValue"}
    body = "&".join(f"{k}={items[k]}" for k in sorted(items, key=str.lower))
    return hashlib.sha256(ecpay_url_encode(f"HashKey={key}&{body}&HashIV={iv}").encode()).hexdigest().upper()


def resp(code, body):
    return {"statusCode": code, "headers": {"Content-Type": "application/json"},
            "body": json.dumps(body, ensure_ascii=False)}


def num(d):
    return int(d) if d == d.to_integral() else float(d)


def checkout_html(email, route, plan):
    c = cfg()
    tw = datetime.now(timezone(timedelta(hours=8)))  # MerchantTradeDate must be UTC+8
    mtn = "FP" + tw.strftime("%y%m%d%H%M%S") + secrets.token_hex(3).upper()  # 20 chars
    amount = str(int(c["amount"]))
    ptype, freq, times = PERIOD
    p = {"MerchantID": c["merchant_id"], "MerchantTradeNo": mtn,
         "MerchantTradeDate": tw.strftime("%Y/%m/%d %H:%M:%S"), "PaymentType": "aio",
         "TotalAmount": amount, "TradeDesc": "Flight Price Notifier monthly plan",
         "ItemName": f"機票降價通知月訂閱 {plan['name']}", "ChoosePayment": "Credit", "EncryptType": "1",
         "ReturnURL": f"{API}/ecpay-return", "PeriodReturnURL": f"{API}/ecpay-period",
         "OrderResultURL": f"{API}/ecpay-result",
         "PeriodAmount": amount, "PeriodType": ptype, "Frequency": str(freq), "ExecTimes": str(times),
         "CustomField1": email, "CustomField2": route}
    p["CheckMacValue"] = gen_cmv(p, c["hash_key"], c["hash_iv"])
    host = "payment.ecpay.com.tw" if c.get("env") == "prod" else "payment-stage.ecpay.com.tw"
    inputs = "".join(f'<input type="hidden" name="{html.escape(k)}" value="{html.escape(v)}">' for k, v in p.items())
    page = (f'<!doctype html><html><head><meta charset="utf-8"><title>前往綠界付款…</title></head><body>'
            f'<p>正在前往綠界付款頁…</p><form id="ecpay" action="https://{host}/Cashier/AioCheckOut/V5" '
            f'method="post">{inputs}</form><script>document.forms[0].submit()</script></body></html>')
    return mtn, page


def handler(event, context):
    try:
        raw = event.get("body") if isinstance(event, dict) and "body" in event else event
        data = json.loads(raw) if isinstance(raw, str) else (raw or {})
    except Exception:
        return resp(400, {"error": "invalid JSON"})
    email = str(data.get("email") or "").strip().lower()
    plan = str(data.get("plan_name") or "").strip().lower()
    if not email or "@" not in email:
        return resp(400, {"error": "email required"})
    if plan not in PLANS:
        return resp(400, {"error": "plan_name must be tokyo, seoul or london"})
    try:
        tp = Decimal(str(data.get("target_price")))
    except (InvalidOperation, TypeError):
        return resp(400, {"error": "target_price must be a number"})
    if tp <= 0:
        return resp(400, {"error": "target_price must be positive"})
    p = PLANS[plan]
    route = f"{p['origin']}-{p['destination']}"
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    old = ddb.get_item(Key={"email": email, "route": route}).get("Item") or {}
    status = old.get("subscription_status")
    paid = status == "active" or (status == "cancelled" and old.get("current_period_end", "") >= now)
    if paid:
        # Already paid (or cancelled but still in grace): update the target in place, no re-payment.
        ddb.update_item(Key={"email": email, "route": route},
                        UpdateExpression="SET target_price = :t, updated_at = :u",
                        ExpressionAttributeValues={":t": tp, ":u": now})
        return resp(200, {"ok": True, "email": email, "route": route, "plan_name": plan,
                          "target_price": num(tp), "currency": "TWD", "subscription_status": status})
    mtn, page = checkout_html(email, route, p)
    ddb.update_item(
        Key={"email": email, "route": route},
        UpdateExpression="SET plan_name = :p, origin = :o, destination = :d, target_price = :t, currency = :c, "
                         "created_at = if_not_exists(created_at, :u), updated_at = :u, "
                         "subscription_status = :s, merchant_trade_no = :m",
        ExpressionAttributeValues={":p": plan, ":o": p["origin"], ":d": p["destination"], ":t": tp,
                                   ":c": "TWD", ":u": now, ":s": "pending_payment", ":m": mtn})
    print("checkout", email, route, mtn)
    return {"statusCode": 200, "headers": {"Content-Type": "text/html; charset=utf-8"}, "body": page}
