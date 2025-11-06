// hooks/useUnderstaffedDetection.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

export const useUnderstaffedDetection = (selectedShiftId: string = "all") => {
  return useQuery({
    queryKey: ["understaffed-shifts-detection", selectedShiftId],
    queryFn: async () => {
      console.log("🔍 Starting understaffed shift detection...");
      
      const allUnderstaffedShifts = [];
      const today = new Date();

      // Check each date in the next 7 days
      for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(today.getDate() + i);
        const dateStr = format(date, "yyyy-MM-dd");
        const dayOfWeek = date.getDay();

        try {
          // Get minimum staffing requirements for this day of week
          const { data: minimumStaffing, error: minError } = await supabase
            .from("minimum_staffing")
            .select("minimum_officers, minimum_supervisors, shift_type_id")
            .eq("day_of_week", dayOfWeek);
          
          if (minError) {
            console.error(`❌ Error getting minimum staffing for ${dateStr}:`, minError);
            continue;
          }

          // Get schedule data using the same function as DailyScheduleView
          const scheduleData = await getScheduleData(date, selectedShiftId);
          
          if (!scheduleData || scheduleData.length === 0) {
            continue;
          }

          // Check each shift for understaffing
          for (const shiftData of scheduleData) {
            const shift = shiftData.shift;
            
            // Filter by selected shift if needed
            if (selectedShiftId !== "all" && shift.id !== selectedShiftId) {
              continue;
            }

            // Get minimum staffing for this specific shift from the database
            const minStaff = minimumStaffing?.find(m => m.shift_type_id === shift.id);
            const minSupervisors = minStaff?.minimum_supervisors || 1;
            const minOfficers = minStaff?.minimum_officers || 8;

            const supervisorsUnderstaffed = shiftData.currentSupervisors < minSupervisors;
            const officersUnderstaffed = shiftData.currentOfficers < minOfficers;
            const isUnderstaffed = supervisorsUnderstaffed || officersUnderstaffed;

            if (isUnderstaffed) {
              const shiftAlertData = {
                date: dateStr,
                shift_type_id: shift.id,
                shift_types: {
                  id: shift.id,
                  name: shift.name,
                  start_time: shift.start_time,
                  end_time: shift.end_time
                },
                current_staffing: shiftData.currentSupervisors + shiftData.currentOfficers,
                minimum_required: minSupervisors + minOfficers,
                current_supervisors: shiftData.currentSupervisors,
                current_officers: shiftData.currentOfficers,
                min_supervisors: minSupervisors,
                min_officers: minOfficers,
                day_of_week: dayOfWeek,
                isSupervisorsUnderstaffed: supervisorsUnderstaffed,
                isOfficersUnderstaffed: officersUnderstaffed
              };

              allUnderstaffedShifts.push(shiftAlertData);
            }
          }
        } catch (dayError) {
          console.error(`❌ Error processing date ${dateStr}:`, dayError);
          continue;
        }
      }

      return allUnderstaffedShifts;
    },
  });
};
