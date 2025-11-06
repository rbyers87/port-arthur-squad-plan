// hooks/useUnderstaffedDetection.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { getScheduleData } from "@/components/schedule/DailyScheduleView";

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

          console.log("📊 Minimum staffing requirements:", minimumStaffing);

          // Use the getScheduleData function from DailyScheduleView with correct path
          const scheduleData = await getScheduleData(date, selectedShiftId);
          
          if (!scheduleData || scheduleData.length === 0) {
            console.log(`❌ No schedule data found for ${dateStr}`);
            continue;
          }

          console.log(`📋 Schedule data for ${dateStr}:`, scheduleData);

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

            console.log(`\n🔍 Checking shift: ${shift.name} (${shift.start_time} - ${shift.end_time})`);
            console.log(`📋 Min requirements: ${minSupervisors} supervisors, ${minOfficers} officers`);
            console.log(`👥 Current staffing: ${shiftData.currentSupervisors} supervisors, ${shiftData.currentOfficers} officers`);
            console.log(`👤 Assigned officers data:`, shiftData.officers);

            // FIX: Let's recalculate supervisor/officer counts from the actual officer data
            let actualSupervisors = 0;
            let actualOfficers = 0;
            
            const assignedOfficers = Array.isArray(shiftData.officers) ? shiftData.officers.map((officer: any) => {
              // Handle different possible data structures
              const fullName = officer.full_name || officer.name || officer.profiles?.full_name || "Unknown";
              const isSupervisor = officer.is_supervisor || officer.profiles?.is_supervisor || false;
              const badgeNumber = officer.badge_number || officer.profiles?.badge_number || "N/A";
              
              // Count supervisors and officers based on actual data
              if (isSupervisor) {
                actualSupervisors++;
              } else {
                actualOfficers++;
              }
              
              return {
                name: fullName,
                position: isSupervisor ? "Supervisor" : "Officer",
                isSupervisor: isSupervisor,
                badge: badgeNumber
              };
            }) : [];

            // Use the recalculated counts instead of relying on shiftData counts
            const currentSupervisors = actualSupervisors;
            const currentOfficers = actualOfficers;
            const currentStaffing = currentSupervisors + currentOfficers;

            console.log(`🔍 RECALCULATED - Supervisors: ${currentSupervisors}, Officers: ${currentOfficers}`);

            // Check if understaffed using recalculated counts
            const supervisorsUnderstaffed = currentSupervisors < minSupervisors;
            const officersUnderstaffed = currentOfficers < minOfficers;
            const isUnderstaffed = supervisorsUnderstaffed || officersUnderstaffed;

            if (isUnderstaffed) {
              let positionType = "";
              if (supervisorsUnderstaffed && officersUnderstaffed) {
                positionType = `${minSupervisors - currentSupervisors} Supervisor(s), ${minOfficers - currentOfficers} Officer(s)`;
              } else if (supervisorsUnderstaffed) {
                positionType = `${minSupervisors - currentSupervisors} Supervisor(s)`;
              } else {
                positionType = `${minOfficers - currentOfficers} Officer(s)`;
              }

              const shiftAlertData = {
                date: dateStr,
                shift_type_id: shift.id,
                shift_types: {
                  id: shift.id,
                  name: shift.name,
                  start_time: shift.start_time,
                  end_time: shift.end_time
                },
                current_staffing: currentStaffing,
                minimum_required: minSupervisors + minOfficers,
                current_supervisors: currentSupervisors,
                current_officers: currentOfficers,
                min_supervisors: minSupervisors,
                min_officers: minOfficers,
                day_of_week: dayOfWeek,
                isSupervisorsUnderstaffed: supervisorsUnderstaffed,
                isOfficersUnderstaffed: officersUnderstaffed,
                position_type: positionType,
                assigned_officers: assignedOfficers
              };

              console.log("📊 Storing understaffed shift data:", shiftAlertData);
              allUnderstaffedShifts.push(shiftAlertData);
            } else {
              console.log("✅ Shift is properly staffed");
            }
          }
        } catch (dayError) {
          console.error(`❌ Error processing date ${dateStr}:`, dayError);
          continue;
        }
      }

      console.log("🎯 Total understaffed shifts found:", allUnderstaffedShifts.length);
      return allUnderstaffedShifts;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};
