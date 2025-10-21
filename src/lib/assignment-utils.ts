// lib/assignment-utils.ts
import { supabase } from "@/integrations/supabase/client";

export interface ScheduleShift {
  id: string;
  officer_id: string;
  date: string;
  position: string;
  unit: string;
  notes?: string;
  profiles: {
    id: string;
    full_name: string;
    badge_number?: string;
    rank?: string;
  };
  shift_types: {
    id: string;
    name: string;
    start_time: string;
    end_time: string;
  };
}

export interface OfficerWithDefaults {
  id: string;
  full_name: string;
  default_position?: string | null;
  default_unit?: string | null;
}

export const applyDefaultAssignments = async (scheduleShifts: ScheduleShift[], date: string) => {
  // Get all officers with their default assignments
  const { data: officers, error } = await supabase
    .from("profiles")
    .select("id, full_name, default_position, default_unit")
    .not("default_position", "is", null);

  if (error) {
    console.error("Error fetching officers with defaults:", error);
    return scheduleShifts;
  }

  // Create a map for quick lookup
  const officerDefaults = new Map(
    officers.map(officer => [officer.id, officer])
  );

  // Apply defaults where possible
  return scheduleShifts.map(shift => {
    const officer = officerDefaults.get(shift.officer_id);
    
    // Only apply defaults if the shift doesn't already have an assignment
    if (officer && (!shift.position || shift.position === '' || shift.position === 'No Position')) {
      return {
        ...shift,
        position: officer.default_position || shift.position,
        unit: officer.default_unit || shift.unit
      };
    }
    
    return shift;
  });
};

export const bulkApplyDefaults = async (scheduleShifts: ScheduleShift[], date: string) => {
  const updatedShifts = await applyDefaultAssignments(scheduleShifts, date);
  
  // Update the shifts in the database - handle both recurring_schedules and schedule_exceptions
  const updates = updatedShifts.map(async (shift) => {
    try {
      // First check if this is a recurring schedule or exception
      const { data: recurringSchedule, error: recurringError } = await supabase
        .from("recurring_schedules")
        .select("id, position_name")
        .eq("id", shift.id)
        .single();

      if (!recurringError && recurringSchedule) {
        // Update recurring_schedules - only position_name exists in this table
        const updateData: any = {
          position_name: shift.position
        };
        
        const { error: updateError } = await supabase
          .from("recurring_schedules")
          .update(updateData)
          .eq("id", shift.id);

        if (updateError) {
          console.error(`Failed to update recurring schedule ${shift.id}:`, updateError);
          return { success: false, error: updateError.message };
        }
      } else {
        // Check schedule_exceptions
        const { data: exception, error: exceptionError } = await supabase
          .from("schedule_exceptions")
          .select("id, position_name, unit_number")
          .eq("id", shift.id)
          .single();

        if (exceptionError) {
          console.warn(`Shift ${shift.id} not found in either table`);
          return { success: false, error: "Shift not found" };
        }

        // Update schedule_exceptions - this table has both position_name and unit_number
        const updateData: any = {
          position_name: shift.position
        };
        
        // Only update unit_number if it exists in the table and we have a value
        if (shift.unit) {
          updateData.unit_number = shift.unit;
        }
        
        const { error: updateError } = await supabase
          .from("schedule_exceptions")
          .update(updateData)
          .eq("id", shift.id);

        if (updateError) {
          console.error(`Failed to update exception ${shift.id}:`, updateError);
          return { success: false, error: updateError.message };
        }
      }

      return { success: true };
    } catch (error) {
      console.error(`Error updating shift ${shift.id}:`, error);
      return { success: false, error: String(error) };
    }
  });

  const results = await Promise.all(updates);
  
  // Check for errors
  const failedUpdates = results.filter(result => !result.success);
  if (failedUpdates.length > 0) {
    console.error(`${failedUpdates.length} assignments failed to update:`, failedUpdates);
    throw new Error(`${failedUpdates.length} assignments failed to update`);
  }
  
  return updatedShifts;
};
