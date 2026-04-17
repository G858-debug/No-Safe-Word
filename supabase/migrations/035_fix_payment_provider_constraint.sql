-- Add 'payfast' to the payment_provider CHECK constraint on nsw_payments
ALTER TABLE nsw_payments
  DROP CONSTRAINT IF EXISTS nsw_payments_payment_provider_check;

ALTER TABLE nsw_payments
  ADD CONSTRAINT nsw_payments_payment_provider_check
  CHECK (payment_provider IN ('paystack', 'yoco', 'stripe', 'payfast'));
