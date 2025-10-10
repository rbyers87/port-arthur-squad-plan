-- Create enum for roles
CREATE TYPE public.app_role AS ENUM ('admin', 'supervisor', 'officer');

-- Create user_roles table
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles safely
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create helper function to check if user has admin or supervisor role
CREATE OR REPLACE FUNCTION public.has_admin_or_supervisor_role(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin', 'supervisor')
  )
$$;

-- Migrate existing roles from profiles to user_roles
INSERT INTO public.user_roles (user_id, role)
SELECT id, role::app_role
FROM public.profiles
ON CONFLICT (user_id, role) DO NOTHING;

-- RLS policies for user_roles table
CREATE POLICY "Users can view their own roles"
  ON public.user_roles
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage all roles"
  ON public.user_roles
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Update RLS policies on profiles table
DROP POLICY IF EXISTS "Enable update for users based on id" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Update RLS policies on minimum_staffing
DROP POLICY IF EXISTS "Admins can manage minimum staffing" ON public.minimum_staffing;
DROP POLICY IF EXISTS "Admins can update minimum staffing" ON public.minimum_staffing;
DROP POLICY IF EXISTS "Admins can delete minimum staffing" ON public.minimum_staffing;

CREATE POLICY "Admins can insert minimum staffing"
  ON public.minimum_staffing
  FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update minimum staffing"
  ON public.minimum_staffing
  FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete minimum staffing"
  ON public.minimum_staffing
  FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- Update RLS policies on recurring_schedules
DROP POLICY IF EXISTS "Supervisors and admins can manage recurring schedules" ON public.recurring_schedules;
DROP POLICY IF EXISTS "Supervisors and admins can update recurring schedules" ON public.recurring_schedules;
DROP POLICY IF EXISTS "Supervisors and admins can delete recurring schedules" ON public.recurring_schedules;
DROP POLICY IF EXISTS "Supervisors and admins can view all recurring schedules" ON public.recurring_schedules;

CREATE POLICY "Admins and supervisors can insert recurring schedules"
  ON public.recurring_schedules
  FOR INSERT
  WITH CHECK (public.has_admin_or_supervisor_role(auth.uid()));

CREATE POLICY "Admins and supervisors can update recurring schedules"
  ON public.recurring_schedules
  FOR UPDATE
  USING (public.has_admin_or_supervisor_role(auth.uid()))
  WITH CHECK (public.has_admin_or_supervisor_role(auth.uid()));

CREATE POLICY "Admins and supervisors can delete recurring schedules"
  ON public.recurring_schedules
  FOR DELETE
  USING (public.has_admin_or_supervisor_role(auth.uid()));

CREATE POLICY "Admins and supervisors can view all recurring schedules"
  ON public.recurring_schedules
  FOR SELECT
  USING (public.has_admin_or_supervisor_role(auth.uid()));

-- Update RLS policies on schedule_exceptions
DROP POLICY IF EXISTS "Supervisors and admins can manage schedule exceptions" ON public.schedule_exceptions;
DROP POLICY IF EXISTS "Supervisors and admins can update schedule exceptions" ON public.schedule_exceptions;
DROP POLICY IF EXISTS "Supervisors and admins can delete schedule exceptions" ON public.schedule_exceptions;
DROP POLICY IF EXISTS "Supervisors and admins can view all schedule exceptions" ON public.schedule_exceptions;

CREATE POLICY "Admins and supervisors can insert schedule exceptions"
  ON public.schedule_exceptions
  FOR INSERT
  WITH CHECK (public.has_admin_or_supervisor_role(auth.uid()));

CREATE POLICY "Admins and supervisors can update schedule exceptions"
  ON public.schedule_exceptions
  FOR UPDATE
  USING (public.has_admin_or_supervisor_role(auth.uid()))
  WITH CHECK (public.has_admin_or_supervisor_role(auth.uid()));

CREATE POLICY "Admins and supervisors can delete schedule exceptions"
  ON public.schedule_exceptions
  FOR DELETE
  USING (public.has_admin_or_supervisor_role(auth.uid()));

CREATE POLICY "Admins and supervisors can view all schedule exceptions"
  ON public.schedule_exceptions
  FOR SELECT
  USING (public.has_admin_or_supervisor_role(auth.uid()));

-- Update RLS policies on shift_positions
DROP POLICY IF EXISTS "Admins and supervisors can manage positions" ON public.shift_positions;

CREATE POLICY "Admins and supervisors can manage positions"
  ON public.shift_positions
  FOR ALL
  USING (public.has_admin_or_supervisor_role(auth.uid()))
  WITH CHECK (public.has_admin_or_supervisor_role(auth.uid()));

-- Update RLS policies on time_off_requests
DROP POLICY IF EXISTS "Supervisors and admins can update time off requests" ON public.time_off_requests;
DROP POLICY IF EXISTS "Supervisors and admins can view all time off requests" ON public.time_off_requests;

CREATE POLICY "Admins and supervisors can update time off requests"
  ON public.time_off_requests
  FOR UPDATE
  USING (public.has_admin_or_supervisor_role(auth.uid()))
  WITH CHECK (public.has_admin_or_supervisor_role(auth.uid()));

CREATE POLICY "Admins and supervisors can view all time off requests"
  ON public.time_off_requests
  FOR SELECT
  USING (public.has_admin_or_supervisor_role(auth.uid()));

-- Update RLS policies on vacancy_alerts
DROP POLICY IF EXISTS "Supervisors and admins can manage vacancy alerts" ON public.vacancy_alerts;
DROP POLICY IF EXISTS "Supervisors and admins can update vacancy alerts" ON public.vacancy_alerts;

CREATE POLICY "Admins and supervisors can insert vacancy alerts"
  ON public.vacancy_alerts
  FOR INSERT
  WITH CHECK (public.has_admin_or_supervisor_role(auth.uid()));

CREATE POLICY "Admins and supervisors can update vacancy alerts"
  ON public.vacancy_alerts
  FOR UPDATE
  USING (public.has_admin_or_supervisor_role(auth.uid()))
  WITH CHECK (public.has_admin_or_supervisor_role(auth.uid()));

-- Update RLS policies on vacancy_responses
DROP POLICY IF EXISTS "Supervisors and admins can update vacancy responses" ON public.vacancy_responses;
DROP POLICY IF EXISTS "Supervisors and admins can view all vacancy responses" ON public.vacancy_responses;

CREATE POLICY "Admins and supervisors can update vacancy responses"
  ON public.vacancy_responses
  FOR UPDATE
  USING (public.has_admin_or_supervisor_role(auth.uid()))
  WITH CHECK (public.has_admin_or_supervisor_role(auth.uid()));

CREATE POLICY "Admins and supervisors can view all vacancy responses"
  ON public.vacancy_responses
  FOR SELECT
  USING (public.has_admin_or_supervisor_role(auth.uid()));

-- Remove the role column from profiles (no longer needed)
ALTER TABLE public.profiles DROP COLUMN role;
