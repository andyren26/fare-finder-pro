import { Link, useNavigate, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell } from "lucide-react";

import { RoutePlans } from "@/components/RoutePlans";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/use-page-meta";
import { supabase } from "@/integrations/supabase/client";

// Dashboard: the signed-in user subscribes to a route with a TWD target price and pays
// monthly via ECPay (M2).
// Supabase is used for auth only — subscriptions are stored in DynamoDB on AWS
// via the flight-api (API Gateway → Lambda).
export default function Dashboard() {
  usePageMeta(
    "My dashboard — Flight Price Notifier",
    "Your flight route dashboard for Taipei departures.",
  );
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [awaitingPayment] = useState(() => params.get("purchase") === "success");

  // ECPay sends the browser back to /app?purchase=success|failed (via the ecpay-result redirect).
  useEffect(() => {
    const purchase = params.get("purchase");
    if (!purchase) return;
    if (purchase === "success") toast.success("付款完成！訂閱開通中，稍後會收到確認信。");
    else toast.error("付款沒有完成，可以再按「完成付款」重試一次。");
    setParams({}, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) navigate("/sign-in", { replace: true });
      else setEmail(session.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate("/sign-in", { replace: true });
  }

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <Link to="/" className="flex items-center gap-2">
            <Bell className="size-5 text-primary" aria-hidden />
            <span className="font-display font-bold tracking-tight">Flight Price Notifier</span>
          </Link>
          <Button variant="outline" size="sm" onClick={signOut}>
            登出 Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-16">
        <h1 className="font-display text-3xl font-bold tracking-tight">Hi {email ?? "…"}</h1>
        <p className="mt-3 text-muted-foreground">
          選一條航線、設定你的目標價（新台幣），每月 NT$300。票價低於目標時，我們會寄 email 通知你。
        </p>
        {email ? <RoutePlans email={email} awaitingPayment={awaitingPayment} /> : null}
      </main>
    </div>
  );
}
