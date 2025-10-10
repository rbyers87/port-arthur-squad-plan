-- Drop the unique constraint that prevents multiple schedule exceptions per officer per day
-- This is needed to support partial PTO shifts where an officer works part of the day
-- and takes PTO for another part
ALTER TABLE schedule_exceptions 
DROP CONSTRAINT IF EXISTS schedule_exceptions_officer_id_date_key;

-- Add a new constraint that allows multiple exceptions per officer per day
-- but prevents exact duplicates (same officer, date, times, and off status)
ALTER TABLE schedule_exceptions
ADD CONSTRAINT schedule_exceptions_unique_entry 
UNIQUE (officer_id, date, shift_type_id, custom_start_time, custom_end_time, is_off);
