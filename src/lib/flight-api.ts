// Client for the Flight Price Notifier backend on AWS (API Gateway → Lambda → DynamoDB).
// The browser holds no AWS credentials; it only calls this public HTTP API.
// Supabase stays auth-only — subscriptions live in DynamoDB.

export const FLIGHT_API_URL = (
  (import.meta.env["VITE_FLIGHT_API_URL"] as string | undefined) ??
  "https://rpb93lyjzd.execute-api.us-east-1.amazonaws.com"
).replace(/\/+$/, "");

export type PlanName = "tokyo" | "seoul" | "london";

// M2 paywall lifecycle: pending_payment → active → cancelled (still alerted until
// current_period_end) → expired. Rows from before M2 have no status (treated as unpaid).
export type SubscriptionStatus = "pending_payment" | "active" | "cancelled" | "expired";

export type Subscription = {
  email: string;
  route: string;
  plan_name: PlanName;
  origin: string;
  destination: string;
  target_price: number;
  currency: "TWD";
  created_at: string;
  updated_at: string;
  subscription_status?: SubscriptionStatus;
  current_period_end?: string;
  current_period_end_date?: string;
};

export async function listSubscriptions(email: string): Promise<Subscription[]> {
  const res = await fetch(`${FLIGHT_API_URL}/subscriptions?email=${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error(`無法讀取訂閱 (${res.status})`);
  const data = (await res.json()) as { subscriptions?: Subscription[] };
  return data.subscriptions ?? [];
}

export type SubscribeResult =
  | { kind: "checkout"; html: string } // unpaid: an auto-submit form that POSTs to ECPay
  | { kind: "updated"; subscription_status?: SubscriptionStatus | undefined }; // paid: target updated in place

export async function subscribe(
  email: string,
  plan_name: PlanName,
  target_price: number,
): Promise<SubscribeResult> {
  const res = await fetch(`${FLIGHT_API_URL}/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, plan_name, target_price }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `訂閱失敗 (${res.status})`);
  }
  // /subscribe answers with HTML (go pay at ECPay) or JSON (in-place update) — branch on it.
  if ((res.headers.get("content-type") ?? "").includes("text/html")) {
    return { kind: "checkout", html: await res.text() };
  }
  const data = (await res.json()) as { subscription_status?: SubscriptionStatus };
  return { kind: "updated", subscription_status: data.subscription_status };
}

// Replace the page with ECPay's auto-submit form; its inline script POSTs to the cashier.
export function goToCheckout(html: string) {
  document.open();
  document.write(html);
  document.close();
}

export async function cancelSubscription(
  email: string,
  route: string,
): Promise<{ current_period_end_date?: string }> {
  const res = await fetch(`${FLIGHT_API_URL}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, route }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    current_period_end_date?: string;
  };
  if (!res.ok) throw new Error(body.error ?? `取消失敗 (${res.status})`);
  return body;
}
