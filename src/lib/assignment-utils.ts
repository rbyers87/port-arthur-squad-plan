import { supabase } from "@/integrations/supabase/client";

export interface ScheduleShift {
  id: string;
  officer_id: string;
  date: string;
  position: string;
  unit: string;
  // ... other shift fields
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
    // or if you want to override existing assignments, remove the condition
    if (officer && (!shift.position || shift.position === 'Unassigned')) {
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
  
  // Update the shifts in the database
  const updates = updatedShifts.map(shift => 
    supabase
      .from("shift_assignments") // Replace with your actual table name
      .update({
        position: shift.position,
        unit: shift.unit
      })
      .eq("id", shift.id)
  );

  const results = await Promise.all(updates);
  
  // Check for errors
  const hasErrors = results.some(result => result.error);
  if (hasErrors) {
    throw new Error("Some assignments failed to update");
  }
  
  return updatedShifts;
};
