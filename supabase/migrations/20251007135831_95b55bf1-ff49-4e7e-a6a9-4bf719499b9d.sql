-- Add hire_date and service_credit_override to profiles table
ALTER TABLE public.profiles 
ADD COLUMN hire_date date,
ADD COLUMN service_credit_override numeric;

COMMENT ON COLUMN public.profiles.hire_date IS 'Date when the officer was hired';
COMMENT ON COLUMN public.profiles.service_credit_override IS 'Manually adjusted service credit in years (overrides calculated value)';

-- Create a function to calculate effective service credit
CREATE OR REPLACE FUNCTION public.get_service_credit(profile_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    CASE 
      WHEN service_credit_override IS NOT NULL THEN service_credit_override
      WHEN hire_date IS NOT NULL THEN 
        EXTRACT(YEAR FROM AGE(CURRENT_DATE, hire_date)) + 
        (EXTRACT(MONTH FROM AGE(CURRENT_DATE, hire_date)) / 12.0)
      ELSE 0
    END
  FROM public.profiles
  WHERE id = profile_id
$$;