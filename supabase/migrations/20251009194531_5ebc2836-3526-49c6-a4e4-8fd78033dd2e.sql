-- Create enum for officer ranks
CREATE TYPE public.officer_rank AS ENUM ('Officer', 'Sergeant', 'Lieutenant', 'Deputy Chief', 'Chief');

-- Add rank column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN rank public.officer_rank DEFAULT 'Officer';
