import os, json, datetime, urllib.request, urllib.parse, urllib.error
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Attr

UA = "Mozilla/5.0 (compatible; flight-notifier/1.0)"
_sm = boto3.client("secretsmanager")
_sqs = boto3.client("sqs")
_tbl = boto3.resource("dynamodb").Table("subscriptions")
QURL = os.environ.get("QUEUE_URL") or _sqs.get_queue_url(QueueName="flight-fare-queue")["QueueUrl"]
_token = None

def token():
    global _token
    if _token is None:
        _token = json.loads(_sm.get_secret_value(SecretId="flight/travelpayouts")["SecretString"])["token"]
    return _token

def next_month():
    t = datetime.date.today().replace(day=1)
    return (t + datetime.timedelta(days=32)).strftime("%Y-%m")

def fetch_cheapest(origin, destination, month, tok, currency):
    params = {"origin": origin, "destination": destination, "currency": currency, "token": tok}
    if month:
        params["depart_date"] = month
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"https://api.travelpayouts.com/v1/prices/cheap?{q}",
                                 headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            body = json.loads(r.read())
    except urllib.error.HTTPError as e:
        print("travelpayouts HTTP", e.code, currency, origin, destination)
        return None
    except Exception as e:
        print("travelpayouts error", repr(e), currency, origin, destination)
        return None
    if not body.get("success") or not body.get("data"):
        return None
    offers = body["data"].get(destination, {})
    if not offers:
        return None
    best = min(offers.values(), key=lambda o: o["price"])
    return {"price": best["price"], "currency": currency.upper(), "airline": best.get("airline"),
            "depart_date": best.get("departure_at"), "return_date": best.get("return_at")}

def scan_route(route):
    items, kw = [], {"FilterExpression": Attr("route").eq(route)}
    while True:
        r = _tbl.scan(**kw)
        items += r.get("Items", [])
        if "LastEvaluatedKey" not in r:
            return items
        kw["ExclusiveStartKey"] = r["LastEvaluatedKey"]

def gate(it, now):
    """M2 paywall: serve active, and cancelled rows still inside their paid period.
    Lazily retire cancelled rows whose paid period has ended."""
    status = it.get("subscription_status")
    if status == "active":
        return True
    if status == "cancelled":
        if it.get("current_period_end", "") >= now:  # fixed-width UTC strings compare correctly
            return True
        _tbl.update_item(Key={"email": it["email"], "route": it["route"]},
                         UpdateExpression="SET subscription_status = :x, expired_at = :n, updated_at = :n",
                         ConditionExpression="subscription_status = :c",
                         ExpressionAttributeValues={":x": "expired", ":c": "cancelled", ":n": now})
        print("gate expired", it["email"], it["route"], "period ended", it.get("current_period_end"))
        return False
    return False

def handler(event, context):
    origin, destination = event["origin"], event["destination"]
    route = event.get("route") or f"{origin}-{destination}"
    month = event.get("month") or next_month()
    tok = token()
    tw = fetch_cheapest(origin, destination, month, tok, "twd")
    if not tw:
        # Long-haul routes (e.g. London) often have no cached fare for next month:
        # fall back to the cheapest cached fare on any upcoming date.
        month = None
        tw = fetch_cheapest(origin, destination, None, tok, "twd")
    if not tw:
        print("no TWD fare for", route, "(empty/429) - skipping")
        return {"ok": True, "route": route, "matched": 0}
    us = fetch_cheapest(origin, destination, month, tok, "usd")
    print(route, month or "any-date", "cheapest", tw["price"], "TWD", tw["airline"], "| USD", us["price"] if us else None)
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    matched = 0
    for it in scan_route(route):
        if not gate(it, now):
            print("gate skip", it["email"], route, it.get("subscription_status") or "no-status")
            continue
        tp = Decimal(str(it["target_price"]))
        if tp < Decimal(str(tw["price"])):
            continue
        body = {"email": it["email"], "route": route, "plan_name": it.get("plan_name"), "target_price": int(tp),
                "cheapest": {"price": tw["price"], "currency": "TWD", "airline": tw["airline"],
                             "depart_date": tw["depart_date"], "return_date": tw["return_date"]}}
        if us:
            body["cheapest_usd"] = {"price": us["price"], "currency": "USD", "airline": us["airline"],
                                    "depart_date": us["depart_date"], "return_date": us["return_date"]}
        _sqs.send_message(QueueUrl=QURL, MessageBody=json.dumps(body))
        print("gate enqueue", it["email"], route, it.get("subscription_status"))
        matched += 1
    print(route, "matched", matched)
    return {"ok": True, "route": route, "cheapest": tw["price"], "matched": matched}
