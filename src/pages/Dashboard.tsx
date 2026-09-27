import { Link, useNavigate } from "react-router";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

import { RoutePlans } from "@/components/RoutePlans";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/use-page-meta";
import { supabase } from "@/integrations/supabase/client";

// M1 dashboard: the signed-in user subscribes to a route with a TWD target price.
// Supabase is used for auth only — subscriptions are stored in DynamoDB on AWS
// via the flight-api (API Gateway → Lambda).
export default function Dashboard() {
  usePageMeta(
    "My dashboard — Flight Price Notifier",
    "Your flight route dashboard for Taipei departures.",
  );
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);

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
          選一條航線、設定你的目標價（新台幣）。票價低於目標時，我們會寄 email 通知你。
        </p>
        {email ? <RoutePlans email={email} /> : null}
      </main>
    </div>
  );
}
