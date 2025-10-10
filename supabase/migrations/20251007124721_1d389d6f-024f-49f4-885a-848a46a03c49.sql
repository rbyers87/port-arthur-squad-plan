-- Add position_name field to recurring_schedules and schedule_exceptions
-- to allow storing custom position assignments

ALTER TABLE recurring_schedules 
ADD COLUMN position_name TEXT;

ALTER TABLE schedule_exceptions 
ADD COLUMN position_name TEXT;

-- Add comments for documentation
COMMENT ON COLUMN recurring_schedules.position_name IS 'Custom position name like Supervisor, District 1, etc.';
COMMENT ON COLUMN schedule_exceptions.position_name IS 'Custom position name like Supervisor, District 1, etc.';
