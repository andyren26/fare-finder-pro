import { useCallback, useEffect, useState } from "react";
import { Check, Clock, Plane } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  cancelSubscription,
  goToCheckout,
  listSubscriptions,
  subscribe,
  type PlanName,
  type Subscription,
  type SubscriptionStatus,
} from "@/lib/flight-api";

const PLANS: { plan: PlanName; title: string; route: string; destination: string; hint: number }[] =
  [
    { plan: "tokyo", title: "台北 ✈ 東京", route: "TPE-TYO", destination: "TYO", hint: 9325 },
    { plan: "seoul", title: "台北 ✈ 首爾", route: "TPE-SEL", destination: "SEL", hint: 5989 },
    { plan: "london", title: "台北 ✈ 倫敦", route: "TPE-LON", destination: "LON", hint: 22786 },
  ];

// Display only — the amount actually charged comes from the `flight/ecpay` secret on AWS.
const MONTHLY_PRICE = 300;

const twd = (n: number) => `NT$${n.toLocaleString("zh-TW")}`;

// Rows from before the paywall have no status: they behave like an unpaid subscription.
function statusOf(sub: Subscription | undefined): SubscriptionStatus | "none" {
  if (!sub) return "none";
  const s = sub.subscription_status ?? "pending_payment";
  if (
    s === "cancelled" &&
    sub.current_period_end &&
    sub.current_period_end < new Date().toISOString()
  )
    return "expired";
  return s;
}

function StatusBadge({ status }: { status: SubscriptionStatus | "none" }) {
  if (status === "active")
    return (
      <Badge className="gap-1">
        <Check className="size-3" aria-hidden />
        已訂閱（有效）
      </Badge>
    );
  if (status === "pending_payment")
    return (
      <Badge variant="secondary" className="gap-1">
        <Clock className="size-3" aria-hidden />
        未完成付款
      </Badge>
    );
  if (status === "cancelled") return <Badge variant="outline">已取消</Badge>;
  if (status === "expired") return <Badge variant="outline">已結束</Badge>;
  return null;
}

function PlanCard({
  email,
  plan,
  sub,
  onChanged,
}: {
  email: string;
  plan: (typeof PLANS)[number];
  sub: Subscription | undefined;
  onChanged: () => void;
}) {
  const status = statusOf(sub);
  const paid = status === "active" || status === "cancelled";
  const [value, setValue] = useState(sub ? String(sub.target_price) : "");
  const [editing, setEditing] = useState(!sub);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    if (sub) {
      setValue(String(sub.target_price));
      setEditing(false);
    }
  }, [sub]);

  async function save(price: number) {
    if (!Number.isFinite(price) || price <= 0) {
      toast.error("請輸入大於 0 的目標價（新台幣）");
      return;
    }
    setBusy(true);
    try {
      const result = await subscribe(email, plan.plan, price);
      if (result.kind === "checkout") {
        goToCheckout(result.html); // leaves the page for ECPay's cashier
        return;
      }
      toast.success(`已更新 ${plan.title} 的目標價為 ${twd(price)}`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "訂閱失敗，請再試一次");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      const r = await cancelSubscription(email, plan.route);
      toast.success(
        `已取消 ${plan.title} 訂閱，之後不會再扣款` +
          (r.current_period_end_date ? `；${r.current_period_end_date} 前仍會通知你` : ""),
      );
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "取消失敗，請再試一次");
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  }

  const submitLabel = paid ? "儲存" : `訂閱並付款 ${twd(MONTHLY_PRICE)}/月`;

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-6 shadow-lift">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Plane className="size-5 text-primary" aria-hidden />
          <h2 className="font-display text-xl font-bold tracking-tight">{plan.title}</h2>
        </div>
        <StatusBadge status={status} />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        最近最低價約 {twd(plan.hint)}，建議設一個稍高於這個數字的預算。
      </p>

      {status === "active" && sub?.current_period_end_date && (
        <p className="mt-3 text-sm">
          每月 {twd(MONTHLY_PRICE)}，下次扣款日 {sub.current_period_end_date}
        </p>
      )}
      {status === "cancelled" && (
        <p className="mt-3 text-sm">
          有效至 <span className="font-semibold">{sub?.current_period_end_date}</span>
          ，到期前仍會寄降價通知給你。
        </p>
      )}
      {status === "pending_payment" && (
        <p className="mt-3 text-sm">
          付款完成後才會開始寄降價通知（每月 {twd(MONTHLY_PRICE)}，隨時可取消）。
        </p>
      )}
      {status === "expired" && <p className="mt-3 text-sm">訂閱已結束，重新訂閱即可恢復通知。</p>}

      {sub && !editing ? (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              目標價 <span className="font-semibold">{twd(sub.target_price)}</span>
            </p>
            <Button variant="outline" disabled={busy} onClick={() => setEditing(true)}>
              更新目標價
            </Button>
          </div>
          {(status === "pending_payment" || status === "expired") && (
            <Button className="w-full" disabled={busy} onClick={() => void save(sub.target_price)}>
              {busy
                ? "前往付款…"
                : status === "expired"
                  ? `重新訂閱 ${twd(MONTHLY_PRICE)}/月`
                  : "完成付款 Pay"}
            </Button>
          )}
          {status === "active" &&
            (confirmCancel ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
                <span className="flex-1">確定取消？之後不再扣款，本期到期前仍會通知。</span>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void cancel()}
                >
                  {busy ? "取消中…" : "確定取消"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmCancel(false)}
                >
                  返回
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setConfirmCancel(true)}
              >
                取消訂閱
              </Button>
            ))}
        </div>
      ) : (
        <form
          className="mt-5 flex flex-wrap gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save(Number(value));
          }}
        >
          <label className="sr-only" htmlFor={`target-${plan.plan}`}>
            目標價（新台幣）
          </label>
          <Input
            id={`target-${plan.plan}`}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            placeholder="目標價 NT$"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Button type="submit" disabled={busy}>
            {busy ? "處理中…" : submitLabel}
          </Button>
          {sub && (
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              取消
            </Button>
          )}
        </form>
      )}
    </div>
  );
}

export function RoutePlans({
  email,
  awaitingPayment,
}: {
  email: string;
  awaitingPayment?: boolean;
}) {
  const [subs, setSubs] = useState<Record<string, Subscription>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const rows = await listSubscriptions(email);
    setSubs(Object.fromEntries(rows.map((r) => [r.route, r])));
    return rows;
  }, [email]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    load()
      .catch((err) => toast.error(err instanceof Error ? err.message : "無法讀取訂閱"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [load]);

  // Back from ECPay: the server-to-server callback may land a moment after the browser does,
  // so re-check a few times until no subscription is still waiting for payment.
  useEffect(() => {
    if (!awaitingPayment) return;
    let tries = 0;
    const id = window.setInterval(async () => {
      tries += 1;
      const rows = await load().catch(() => []);
      const pending = rows.some(
        (r) => (r.subscription_status ?? "pending_payment") === "pending_payment",
      );
      if (!pending || tries >= 6) window.clearInterval(id);
    }, 2500);
    return () => window.clearInterval(id);
  }, [awaitingPayment, load]);

  if (loading) {
    return <p className="mt-8 text-muted-foreground">正在讀取你的訂閱…</p>;
  }

  return (
    <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {PLANS.map((p) => (
        <PlanCard
          key={p.plan}
          email={email}
          plan={p}
          sub={subs[p.route]}
          onChanged={() => void load().catch(() => undefined)}
        />
      ))}
    </div>
  );
}
