-- Add minimum_supervisors column to minimum_staffing table
ALTER TABLE public.minimum_staffing 
ADD COLUMN minimum_supervisors integer NOT NULL DEFAULT 1;