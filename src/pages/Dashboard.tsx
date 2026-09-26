import { Link, useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bell, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePageMeta } from "@/hooks/use-page-meta";
import { supabase } from "@/integrations/supabase/client";

type Alert = {
  id: string;
  origin: string;
  destination: string;
  target_price: number;
  currency: string;
  is_active: boolean;
  created_at: string;
};

export default function Dashboard() {
  usePageMeta(
    "My alerts — Flight Price Notifier",
    "Manage the flight routes you watch from Taipei and the target price for each one.",
  );
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [origin, setOrigin] = useState("TPE");
  const [destination, setDestination] = useState("");
  const [targetPrice, setTargetPrice] = useState("");

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ["price_alerts"],
    queryFn: async (): Promise<Alert[]> => {
      const { data, error } = await supabase
        .from("price_alerts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Alert[];
    },
  });

  const createAlert = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.from("price_alerts").insert({
        user_id: userId,
        origin: origin.toUpperCase(),
        destination: destination.toUpperCase(),
        target_price: Number(targetPrice),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setDestination("");
      setTargetPrice("");
      toast.success("已建立通知 / Alert created");
      queryClient.invalidateQueries({ queryKey: ["price_alerts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteAlert = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("price_alerts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["price_alerts"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
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

      <main className="mx-auto max-w-5xl px-5 py-12">
        <h1 className="font-display text-3xl font-bold tracking-tight">我的通知 My alerts</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          設定航線與目標價，機票降價就通知你。
        </p>

        <form
          className="mt-8 grid gap-4 rounded-xl border border-border bg-card p-6 shadow-lift sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            createAlert.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="origin">出發地 From</Label>
            <Input id="origin" value={origin} onChange={(e) => setOrigin(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="destination">目的地 To</Label>
            <Input
              id="destination"
              placeholder="NRT"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="price">目標價 Target (TWD)</Label>
            <Input
              id="price"
              type="number"
              min={1}
              placeholder="6000"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={createAlert.isPending}>
            新增 Add
          </Button>
        </form>

        <section className="mt-10">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : alerts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              尚未設定通知 / No alerts yet — add your first route above.
            </p>
          ) : (
            <ul className="space-y-3">
              {alerts.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded-xl border border-border bg-card px-5 py-4"
                >
                  <div>
                    <p className="font-display font-semibold tracking-wide">
                      {a.origin} → {a.destination}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Target {a.currency} {a.target_price.toLocaleString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete alert"
                    onClick={() => deleteAlert.mutate(a.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
