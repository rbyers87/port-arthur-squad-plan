-- Create table for PTO accrual rules
CREATE TABLE public.pto_accrual_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_type text NOT NULL CHECK (rule_type IN ('holiday', 'vacation')),
  service_credit_min numeric NOT NULL DEFAULT 0,
  service_credit_max numeric,
  hours_to_accrue numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.pto_accrual_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can manage PTO accrual rules"
ON public.pto_accrual_rules
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can view PTO accrual rules"
ON public.pto_accrual_rules
FOR SELECT
USING (true);

-- Insert default rules
INSERT INTO public.pto_accrual_rules (rule_type, service_credit_min, service_credit_max, hours_to_accrue) VALUES
('holiday', 0, NULL, 96),
('vacation', 0, 9.99, 80),
('vacation', 10, 19.99, 120),
('vacation', 20, 24.99, 160),
('vacation', 25, NULL, 200);

-- Create function to accrue annual PTO
CREATE OR REPLACE FUNCTION public.accrue_annual_pto()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_record RECORD;
  service_credit numeric;
  holiday_hours numeric;
  vacation_hours numeric;
BEGIN
  -- Get holiday hours (same for everyone)
  SELECT hours_to_accrue INTO holiday_hours
  FROM public.pto_accrual_rules
  WHERE rule_type = 'holiday'
  LIMIT 1;

  -- Loop through all profiles
  FOR profile_record IN SELECT id FROM public.profiles LOOP
    -- Get service credit for this profile
    SELECT get_service_credit(profile_record.id) INTO service_credit;
    
    -- Find matching vacation tier
    SELECT hours_to_accrue INTO vacation_hours
    FROM public.pto_accrual_rules
    WHERE rule_type = 'vacation'
      AND service_credit >= service_credit_min
      AND (service_credit_max IS NULL OR service_credit <= service_credit_max)
    LIMIT 1;
    
    -- Update profile with accrued hours
    UPDATE public.profiles
    SET 
      holiday_hours = holiday_hours + COALESCE(holiday_hours, 0),
      vacation_hours = vacation_hours + COALESCE(vacation_hours, 0)
    WHERE id = profile_record.id;
  END LOOP;
END;
$$;
