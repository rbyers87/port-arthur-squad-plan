-- Update the service credit calculation to use override as adjustment instead of replacement
CREATE OR REPLACE FUNCTION public.get_service_credit(profile_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    CASE 
      WHEN hire_date IS NOT NULL THEN 
        GREATEST(0, 
          EXTRACT(YEAR FROM AGE(CURRENT_DATE, hire_date)) + 
          (EXTRACT(MONTH FROM AGE(CURRENT_DATE, hire_date)) / 12.0) +
          COALESCE(service_credit_override, 0)
        )
      ELSE COALESCE(service_credit_override, 0)
    END
  FROM public.profiles
  WHERE id = profile_id
$$;