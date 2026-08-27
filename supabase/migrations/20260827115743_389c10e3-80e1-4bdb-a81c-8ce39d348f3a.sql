CREATE TABLE public.price_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  origin TEXT NOT NULL DEFAULT 'TPE',
  destination TEXT NOT NULL,
  target_price INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'TWD',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_alerts TO authenticated;
GRANT ALL ON public.price_alerts TO service_role;
ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own alerts" ON public.price_alerts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER update_price_alerts_updated_at BEFORE UPDATE ON public.price_alerts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();