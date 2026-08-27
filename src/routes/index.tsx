import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bell, Mail, Plane, XCircle } from "lucide-react";

import heroImage from "@/assets/hero-flight.jpg";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Flight Price Notifier — 機票降價通知" },
      {
        name: "description",
        content:
          "Set a route from Taipei and a target price. We watch the fare and email you the moment it drops to your budget.",
      },
      { property: "og:title", content: "Flight Price Notifier — 機票降價通知" },
      {
        property: "og:description",
        content: "設定航線與目標價，機票降價就通知你。Email alerts for cheap flights from Taipei.",
      },
    ],
  }),
  component: Landing,
});

const routes = [
  { city: "東京 Tokyo", code: "TPE → NRT", price: "NT$6,200" },
  { city: "首爾 Seoul", code: "TPE → ICN", price: "NT$5,400" },
  { city: "曼谷 Bangkok", code: "TPE → BKK", price: "NT$7,100" },
  { city: "大阪 Osaka", code: "TPE → KIX", price: "NT$6,800" },
  { city: "新加坡 Singapore", code: "TPE → SIN", price: "NT$8,300" },
  { city: "峴港 Da Nang", code: "TPE → DAD", price: "NT$7,900" },
];

const features = [
  {
    icon: Plane,
    title: "盯緊熱門航線 (Always-on route watching)",
    body: "持續監控台北出發的熱門航線（東京、首爾），自動抓最低票價。",
  },
  {
    icon: Mail,
    title: "達標自動通知 (Target-price email alert)",
    body: "低於你設定的目標價，就寄 email 提醒你，附上立即訂購連結。",
  },
  {
    icon: XCircle,
    title: "隨時取消 (Cancel anytime)",
    body: "月訂閱制，不想用隨時停，沒有綁約。",
  },
];

function Landing() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setSignedIn(!!session),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2">
            <Bell className="size-5 text-primary" aria-hidden />
            <span className="font-display text-base font-bold tracking-tight">
              Flight Price Notifier
            </span>
          </div>
          {signedIn ? (
            <Button asChild variant="default" size="sm">
              <Link to="/dashboard">Dashboard / 我的通知</Link>
            </Button>
          ) : (
            <Button asChild variant="default" size="sm">
              <Link to="/auth">Sign in / 登入</Link>
            </Button>
          )}
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <img
            src={heroImage}
            alt="View of a dusk sky from an airplane window leaving Taipei"
            width={1600}
            height={1000}
            className="absolute inset-0 size-full object-cover opacity-60"
          />
          <div className="absolute inset-0 bg-dusk opacity-90" />
          <div className="absolute inset-0 bg-glow" />
          <div className="relative mx-auto max-w-6xl px-5 py-28 md:py-40">
            <p className="font-display text-xs uppercase tracking-[0.35em] text-accent">
              Taipei departures
            </p>
            <h1 className="mt-5 max-w-3xl font-display text-4xl font-bold leading-tight tracking-tight md:text-6xl">
              Flight Price Notifier
              <span className="block text-2xl text-primary md:text-3xl">機票降價通知</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg font-medium md:text-2xl">
              設定航線與目標價，機票降價就通知你
            </p>
            <p className="mt-3 max-w-xl text-base text-muted-foreground">
              Set a route and a target price — we email you when the fare drops.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/auth">開始追蹤 / Start watching</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#features">Features / 產品特點</a>
              </Button>
            </div>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="font-display text-3xl font-bold tracking-tight">產品特點 Features</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-xl border border-border bg-card p-6 shadow-lift"
              >
                <Icon className="size-6 text-primary" aria-hidden />
                <h3 className="mt-4 font-display text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-border bg-card/40">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <h2 className="font-display text-3xl font-bold tracking-tight">
              熱門航線 Popular routes
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Recent cheapest fares we've tracked out of Taipei.
            </p>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {routes.map((r) => (
                <li
                  key={r.code}
                  className="flex items-center justify-between rounded-xl border border-border bg-background px-5 py-4"
                >
                  <div>
                    <p className="font-display font-semibold">{r.city}</p>
                    <p className="text-xs tracking-widest text-muted-foreground">{r.code}</p>
                  </div>
                  <span className="font-display text-primary">{r.price}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-5 py-24 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight">
            預算到位就出發 Fly when the price is right
          </h2>
          <p className="mt-4 text-muted-foreground">
            Free to start. One email per drop — no spam, unsubscribe anytime.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link to="/auth">Sign in / 登入</Link>
          </Button>
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Flight Price Notifier · 機票降價通知
      </footer>
    </div>
  );
}
