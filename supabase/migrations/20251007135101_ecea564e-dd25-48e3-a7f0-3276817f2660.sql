-- Add PTO type columns to profiles table
ALTER TABLE public.profiles
ADD COLUMN sick_hours numeric DEFAULT 0,
ADD COLUMN comp_hours numeric DEFAULT 0,
ADD COLUMN vacation_hours numeric DEFAULT 80,
ADD COLUMN holiday_hours numeric DEFAULT 0,
ADD COLUMN last_sick_accrual_date date DEFAULT CURRENT_DATE;

-- Remove old generic PTO columns (keeping for backward compatibility initially)
-- We'll migrate data first
UPDATE public.profiles
SET vacation_hours = COALESCE(pto_hours_balance, 80)
WHERE vacation_hours = 0;

-- Add PTO type to time_off_requests
ALTER TABLE public.time_off_requests
ADD COLUMN pto_type text DEFAULT 'vacation',
ADD COLUMN hours_used numeric DEFAULT 0;

-- Add constraint for valid PTO types
ALTER TABLE public.time_off_requests
ADD CONSTRAINT valid_pto_type CHECK (pto_type IN ('sick', 'comp', 'vacation', 'holiday'));

-- Create function to accrue sick time monthly
CREATE OR REPLACE FUNCTION public.accrue_sick_time()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Accrue 10 hours of sick time for all officers on the 1st of the month
  -- Only accrue if last accrual was before this month
  UPDATE public.profiles
  SET 
    sick_hours = sick_hours + 10,
    last_sick_accrual_date = CURRENT_DATE
  WHERE 
    last_sick_accrual_date < DATE_TRUNC('month', CURRENT_DATE)
    OR last_sick_accrual_date IS NULL;
END;
$$;

-- Create function to deduct PTO when request is approved
CREATE OR REPLACE FUNCTION public.deduct_pto_on_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only deduct when status changes to 'approved'
  IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
    -- Calculate hours (assuming 8-hour workdays)
    NEW.hours_used := (NEW.end_date - NEW.start_date + 1) * 8;
    
    -- Deduct from appropriate PTO balance
    UPDATE public.profiles
    SET 
      sick_hours = CASE WHEN NEW.pto_type = 'sick' THEN sick_hours - NEW.hours_used ELSE sick_hours END,
      comp_hours = CASE WHEN NEW.pto_type = 'comp' THEN comp_hours - NEW.hours_used ELSE comp_hours END,
      vacation_hours = CASE WHEN NEW.pto_type = 'vacation' THEN vacation_hours - NEW.hours_used ELSE vacation_hours END,
      holiday_hours = CASE WHEN NEW.pto_type = 'holiday' THEN holiday_hours - NEW.hours_used ELSE holiday_hours END
    WHERE id = NEW.officer_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for automatic PTO deduction
CREATE TRIGGER on_time_off_approval
  BEFORE UPDATE ON public.time_off_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.deduct_pto_on_approval();

COMMENT ON COLUMN public.profiles.sick_hours IS 'Sick time balance in hours - accrues 10 hours on 1st of each month';
COMMENT ON COLUMN public.profiles.comp_hours IS 'Comp time balance in hours';
COMMENT ON COLUMN public.profiles.vacation_hours IS 'Vacation time balance in hours';
COMMENT ON COLUMN public.profiles.holiday_hours IS 'Holiday time balance in hours';
COMMENT ON COLUMN public.time_off_requests.pto_type IS 'Type of PTO: sick, comp, vacation, or holiday';
COMMENT ON COLUMN public.time_off_requests.hours_used IS 'Number of hours used for this request';
