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


def handler(event, context):
    """ReturnURL - first authorization of a recurring order. Source of truth for activation."""
    p, err = check_callback(event)
    if err:
        return err
    mtn = p.get("MerchantTradeNo")
    if p.get("RtnCode") != "1":
        print("first auth failed - row stays pending_payment", mtn, p.get("RtnMsg"))
        return text("1|OK")
    row = find_row(p)
    if not row:
        print("no subscription row for", mtn, p.get("CustomField1"), p.get("CustomField2"))
        return text("1|OK")
    key = {"email": row["email"], "route": row["route"]}
    if row.get("subscription_status") == "active" and row.get("merchant_trade_no") == mtn:
        print("already active for", mtn, "- duplicate callback, skipping")
        return text("1|OK")
    end = add_period(datetime.now(timezone.utc), p.get("PeriodType", "M"), p.get("Frequency", "1"))
    ddb.update_item(
        Key=key,
        UpdateExpression="SET subscription_status = :a, merchant_trade_no = :m, current_period_end = :e, "
                         "current_period_end_date = :d, period_type = :pt, period_frequency = :pf, "
                         "activated_at = :n, last_charged_at = :n, failed_attempts = :z, "
                         "total_success_times = :ts, updated_at = :n",
        ExpressionAttributeValues={":a": "active", ":m": mtn, ":e": end.strftime(TS), ":d": tw_date(end),
                                   ":pt": p.get("PeriodType", "M"), ":pf": p.get("Frequency", "1"),
                                   ":n": now_ts(), ":z": 0, ":ts": int(p.get("TotalSuccessTimes") or 1)})
    enqueue("welcome", row["email"], row["route"], merchant_trade_no=mtn, current_period_end_date=tw_date(end))
    print("ACTIVATED", key, mtn, "paid through", end.strftime(TS))
    return text("1|OK")
