import boto3, json, time, hashlib, hmac, base64, calendar, urllib.parse
from datetime import datetime, timedelta, timezone

TS = "%Y-%m-%dT%H:%M:%SZ"  # fixed-width UTC: current_period_end is compared as a string
ddb = boto3.resource("dynamodb").Table("subscriptions")
_sm = boto3.client("secretsmanager")
_sqs = boto3.client("sqs")
_cfg = None
_qurl = None


def cfg():
    global _cfg
    if _cfg is None:
        _cfg = json.loads(_sm.get_secret_value(SecretId="flight/ecpay")["SecretString"])
    return _cfg


def status_queue():
    global _qurl
    if _qurl is None:
        _qurl = _sqs.get_queue_url(QueueName="flight-status-queue")["QueueUrl"]
    return _qurl


def enqueue(event_type, email, route, **extra):
    body = dict(event_type=event_type, email=email, route=route, **extra)
    _sqs.send_message(QueueUrl=status_queue(), MessageBody=json.dumps(body, ensure_ascii=False))


def ecpay_url_encode(s):
    e = urllib.parse.quote_plus(str(s)).replace("~", "%7E").lower()
    for o, n in (("%2d", "-"), ("%5f", "_"), ("%2e", "."), ("%21", "!"), ("%2a", "*"), ("%28", "("), ("%29", ")")):
        e = e.replace(o, n)
    return e


def gen_cmv(params, key, iv):
    items = {k: v for k, v in params.items() if k != "CheckMacValue"}  # KEEP empty-string fields
    body = "&".join(f"{k}={items[k]}" for k in sorted(items, key=str.lower))
    return hashlib.sha256(ecpay_url_encode(f"HashKey={key}&{body}&HashIV={iv}").encode()).hexdigest().upper()


def verify_cmv(params):
    c = cfg()
    return hmac.compare_digest(str(params.get("CheckMacValue", "")).upper(),
                               gen_cmv(params, c["hash_key"], c["hash_iv"]))


def form_params(event):
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    return {k: v[0] for k, v in urllib.parse.parse_qs(raw, keep_blank_values=True).items()}


def text(body, status=200):
    return {"statusCode": status, "headers": {"Content-Type": "text/plain; charset=utf-8"}, "body": body}


def now_ts():
    return datetime.now(timezone.utc).strftime(TS)


def parse_ts(s):
    return datetime.strptime(s, TS).replace(tzinfo=timezone.utc)


def add_period(dt, ptype, freq):
    freq = int(freq or 1)
    if ptype == "D":
        return dt + timedelta(days=freq)
    months = freq * (12 if ptype == "Y" else 1)
    y, m = divmod(dt.month - 1 + months, 12)
    y, m = dt.year + y, m + 1
    return dt.replace(year=y, month=m, day=min(dt.day, calendar.monthrange(y, m)[1]))


def tw_date(dt):
    return (dt + timedelta(hours=8)).strftime("%Y-%m-%d")


def find_row(params):
    email, route = params.get("CustomField1", "").strip().lower(), params.get("CustomField2", "").strip()
    if email and route:
        item = ddb.get_item(Key={"email": email, "route": route}).get("Item")
        if item:
            return item
    mtn = params.get("MerchantTradeNo")
    kw = {"FilterExpression": "merchant_trade_no = :m", "ExpressionAttributeValues": {":m": mtn}}
    while True:
        r = ddb.scan(**kw)
        if r.get("Items"):
            return r["Items"][0]
        if "LastEvaluatedKey" not in r:
            return None
        kw["ExclusiveStartKey"] = r["LastEvaluatedKey"]


def check_callback(event):
    """Returns (params, None) when the callback is authentic, else (params, error_response)."""
    p = form_params(event)
    safe = {k: v for k, v in p.items() if k != "CheckMacValue"}
    print("callback", json.dumps(safe, ensure_ascii=False))
    if not verify_cmv(p):
        print("CheckMacValueInvalid", "got", p.get("CheckMacValue"))
        return p, text("0|CheckMacValueInvalid", 400)
    if p.get("MerchantID") != cfg()["merchant_id"]:
        print("MerchantID mismatch", p.get("MerchantID"))
        return p, text("0|MerchantIDMismatch", 400)
    if p.get("SimulatePaid") == "1":
        print("SimulatePaid=1 - CMV verified, acknowledged, NOT activating")
        return p, text("1|OK")
    return p, None
import urllib.request


def jresp(code, body):
    return {"statusCode": code, "headers": {"Content-Type": "application/json"},
            "body": json.dumps(body, ensure_ascii=False)}


def ecpay_cancel(mtn):
    c = cfg()
    host = "payment.ecpay.com.tw" if c.get("env") == "prod" else "payment-stage.ecpay.com.tw"
    p = {"MerchantID": c["merchant_id"], "MerchantTradeNo": mtn, "Action": "Cancel", "TimeStamp": str(int(time.time()))}
    p["CheckMacValue"] = gen_cmv(p, c["hash_key"], c["hash_iv"])
    req = urllib.request.Request(f"https://{host}/Cashier/CreditCardPeriodAction",
                                 data=urllib.parse.urlencode(p).encode(), method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded",
                                          "User-Agent": "Mozilla/5.0 (compatible; flight-notifier/1.0)"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            raw = r.read().decode("utf-8", "replace")
    except Exception as e:
        return {"error": repr(e)}
    return {k: v[0] for k, v in urllib.parse.parse_qs(raw, keep_blank_values=True).items()} or {"raw": raw[:300]}


def handler(event, context):
    """POST /cancel {email, route} - stop future renewals, keep service until current_period_end."""
    try:
        data = json.loads(event.get("body") or "{}")
    except Exception:
        return jresp(400, {"error": "invalid JSON"})
    email, route = str(data.get("email") or "").strip().lower(), str(data.get("route") or "").strip()
    if not email or not route:
        return jresp(400, {"error": "email and route required"})
    row = ddb.get_item(Key={"email": email, "route": route}).get("Item")
    if not row or row.get("subscription_status") not in ("active", "cancelled"):
        return jresp(400, {"error": "沒有可取消的有效訂閱"})
    if row["subscription_status"] == "cancelled":
        return jresp(200, {"ok": True, "subscription_status": "cancelled",
                           "current_period_end_date": row.get("current_period_end_date")})
    mtn = row.get("merchant_trade_no")
    result = ecpay_cancel(mtn) if mtn else {"error": "no merchant_trade_no on row"}
    # 90100150 = order unknown to ECPay (e.g. a synthetic stage order) - still cancel locally.
    print("ECPay CreditCardPeriodAction Cancel", mtn, result)
    end_ts, end_date = row.get("current_period_end"), row.get("current_period_end_date")
    if not end_ts:  # activated before period tracking existed: grant one month from now
        end = add_period(datetime.now(timezone.utc), "M", 1)
        end_ts, end_date = end.strftime(TS), tw_date(end)
    ddb.update_item(Key={"email": email, "route": route},
                    UpdateExpression="SET subscription_status = :c, current_period_end = :e, "
                                     "current_period_end_date = :d, cancelled_at = :n, updated_at = :n, "
                                     "ecpay_cancel_rtncode = :r",
                    ExpressionAttributeValues={":c": "cancelled", ":e": end_ts, ":d": end_date, ":n": now_ts(),
                                               ":r": str(result.get("RtnCode", result.get("error", "")))[:100]})
    enqueue("cancel", email, route, merchant_trade_no=mtn or "", current_period_end_date=end_date)
    return jresp(200, {"ok": True, "subscription_status": "cancelled", "current_period_end": end_ts,
                       "current_period_end_date": end_date, "ecpay_rtncode": result.get("RtnCode")})
