-- Fix the accrue_annual_pto function to properly use the accrual rule values
CREATE OR REPLACE FUNCTION public.accrue_annual_pto()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  profile_record RECORD;
  service_credit numeric;
  holiday_hours_to_add numeric;
  vacation_hours_to_add numeric;
BEGIN
  -- Get holiday hours (same for everyone)
  SELECT hours_to_accrue INTO holiday_hours_to_add
  FROM public.pto_accrual_rules
  WHERE rule_type = 'holiday'
  LIMIT 1;

  -- Loop through all profiles
  FOR profile_record IN SELECT id FROM public.profiles LOOP
    -- Get service credit for this profile
    SELECT get_service_credit(profile_record.id) INTO service_credit;
    
    -- Find matching vacation tier
    SELECT hours_to_accrue INTO vacation_hours_to_add
    FROM public.pto_accrual_rules
    WHERE rule_type = 'vacation'
      AND service_credit >= service_credit_min
      AND (service_credit_max IS NULL OR service_credit < service_credit_max)
    ORDER BY service_credit_min DESC
    LIMIT 1;
    
    -- Update profile with accrued hours
    UPDATE public.profiles
    SET 
      holiday_hours = COALESCE(holiday_hours, 0) + COALESCE(holiday_hours_to_add, 0),
      vacation_hours = COALESCE(vacation_hours, 0) + COALESCE(vacation_hours_to_add, 0)
    WHERE id = profile_record.id;
  END LOOP;
END;
$function$;