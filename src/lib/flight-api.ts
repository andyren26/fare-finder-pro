// Client for the Flight Price Notifier backend on AWS (API Gateway → Lambda → DynamoDB).
// The browser holds no AWS credentials; it only calls this public HTTP API.
// Supabase stays auth-only — subscriptions live in DynamoDB.

export const FLIGHT_API_URL = (
  (import.meta.env["VITE_FLIGHT_API_URL"] as string | undefined) ??
  "https://rpb93lyjzd.execute-api.us-east-1.amazonaws.com"
).replace(/\/+$/, "");

export type PlanName = "tokyo" | "seoul";

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
};

export async function listSubscriptions(email: string): Promise<Subscription[]> {
  const res = await fetch(`${FLIGHT_API_URL}/subscriptions?email=${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error(`無法讀取訂閱 (${res.status})`);
  const data = (await res.json()) as { subscriptions?: Subscription[] };
  return data.subscriptions ?? [];
}

export async function subscribe(
  email: string,
  plan_name: PlanName,
  target_price: number,
): Promise<void> {
  const res = await fetch(`${FLIGHT_API_URL}/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, plan_name, target_price }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `訂閱失敗 (${res.status})`);
  }
}
