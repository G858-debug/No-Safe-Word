-- NSW Purchases table — tracks individual story purchases
CREATE TABLE IF NOT EXISTS public.nsw_purchases (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.nsw_users(id) ON DELETE CASCADE,
  series_id uuid NOT NULL REFERENCES public.story_series(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'ZAR',
  payment_id uuid REFERENCES public.nsw_payments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, series_id)
);

COMMENT ON TABLE public.nsw_purchases IS 'No Safe Word individual story purchases';

CREATE INDEX IF NOT EXISTS idx_nsw_purchases_user_id ON public.nsw_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_nsw_purchases_series_id ON public.nsw_purchases(series_id);

-- Enable RLS
ALTER TABLE public.nsw_purchases ENABLE ROW LEVEL SECURITY;

-- Users can view their own purchases
CREATE POLICY "Users can view own purchases"
  ON public.nsw_purchases FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.nsw_users
      WHERE nsw_users.id = nsw_purchases.user_id
      AND nsw_users.auth_user_id = auth.uid()
    )
  );

-- Admins can view all purchases
CREATE POLICY "Admins can view all purchases"
  ON public.nsw_purchases FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.nsw_users
      WHERE nsw_users.auth_user_id = auth.uid()
      AND nsw_users.role = 'admin'
    )
  );
