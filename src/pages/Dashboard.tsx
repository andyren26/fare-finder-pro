import { Link, useNavigate } from "react-router";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/use-page-meta";
import { supabase } from "@/integrations/supabase/client";

// M0 authenticated shell: greets the user and holds the place of the route
// dashboard. Supabase is used for auth only — route subscriptions arrive in M1.1
// and are stored in DynamoDB on AWS, not in Supabase.
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
        <div className="mt-8 rounded-xl border border-dashed border-border bg-card p-10 shadow-lift">
          <p className="text-lg font-medium">
            你的航線追蹤儀表板即將上線 — 下一個里程碑會加上訂閱航線的功能。
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Your dashboard is coming soon. Route-subscription will be added in the next milestone.
          </p>
        </div>
      </main>
    </div>
  );
}
