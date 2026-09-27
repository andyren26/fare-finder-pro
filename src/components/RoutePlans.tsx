import { useEffect, useState } from "react";
import { Check, Plane } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listSubscriptions, subscribe, type PlanName, type Subscription } from "@/lib/flight-api";

const PLANS: { plan: PlanName; title: string; route: string; destination: string; hint: number }[] =
  [
    { plan: "tokyo", title: "台北 ✈ 東京", route: "TPE-TYO", destination: "TYO", hint: 9325 },
    { plan: "seoul", title: "台北 ✈ 首爾", route: "TPE-SEL", destination: "SEL", hint: 5989 },
    { plan: "london", title: "台北 ✈ 倫敦", route: "TPE-LON", destination: "LON", hint: 22786 },
  ];

const twd = (n: number) => `NT$${n.toLocaleString("zh-TW")}`;

function PlanCard({
  email,
  plan,
  sub,
  onSaved,
}: {
  email: string;
  plan: (typeof PLANS)[number];
  sub: Subscription | undefined;
  onSaved: (s: Subscription) => void;
}) {
  const [value, setValue] = useState(sub ? String(sub.target_price) : "");
  const [editing, setEditing] = useState(!sub);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (sub) {
      setValue(String(sub.target_price));
      setEditing(false);
    }
  }, [sub]);

  async function save() {
    const price = Number(value);
    if (!Number.isFinite(price) || price <= 0) {
      toast.error("請輸入大於 0 的目標價（新台幣）");
      return;
    }
    setSaving(true);
    try {
      await subscribe(email, plan.plan, price);
      const now = new Date().toISOString();
      onSaved({
        email,
        route: plan.route,
        plan_name: plan.plan,
        origin: "TPE",
        destination: plan.destination,
        target_price: price,
        currency: "TWD",
        created_at: sub?.created_at ?? now,
        updated_at: now,
      });
      toast.success(`已開始追蹤 ${plan.title}，目標價 ${twd(price)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "訂閱失敗，請再試一次");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-lift">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Plane className="size-5 text-primary" aria-hidden />
          <h2 className="font-display text-xl font-bold tracking-tight">{plan.title}</h2>
        </div>
        {sub && (
          <Badge className="gap-1">
            <Check className="size-3" aria-hidden />
            已訂閱
          </Badge>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        最近最低價約 {twd(plan.hint)}，建議設一個稍高於這個數字的預算。
      </p>

      {sub && !editing ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p>
            目標價 <span className="font-semibold">{twd(sub.target_price)}</span>
          </p>
          <Button variant="outline" onClick={() => setEditing(true)}>
            更新目標價
          </Button>
        </div>
      ) : (
        <form
          className="mt-5 flex flex-wrap gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
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
          <Button type="submit" disabled={saving}>
            {saving ? "儲存中…" : sub ? "儲存" : "開始追蹤"}
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

export function RoutePlans({ email }: { email: string }) {
  const [subs, setSubs] = useState<Record<string, Subscription>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listSubscriptions(email)
      .then((rows) => {
        if (alive) setSubs(Object.fromEntries(rows.map((r) => [r.route, r])));
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "無法讀取訂閱"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [email]);

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
          onSaved={(s) => setSubs((prev) => ({ ...prev, [s.route]: s }))}
        />
      ))}
    </div>
  );
}
