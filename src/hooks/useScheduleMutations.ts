// src/hooks/useScheduleMutations.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PTO_TYPES } from "@/constants/positions";

interface UpdateScheduleParams {
  scheduleId: string;
  type: "recurring" | "exception";
  positionName: string;
  unitNumber?: string;
  notes?: string;
  date: string;
  officerId: string;
  shiftTypeId: string;
  partnerOfficerId?: string;
  isPartnership?: boolean;
}

export const useScheduleMutations = (dateStr: string) => {
  const queryClient = useQueryClient();

  const updateScheduleMutation = useMutation({
    mutationFn: async (params: UpdateScheduleParams) => {
      if (params.type === "recurring") {
        // For recurring officers, update via exceptions table
        const { data: existingExceptions, error: checkError } = await supabase
          .from("schedule_exceptions")
          .select("id")
          .eq("officer_id", params.officerId)
          .eq("date", params.date)
          .eq("shift_type_id", params.shiftTypeId)
          .eq("is_off", false);

        if (checkError) throw checkError;

        if (existingExceptions && existingExceptions.length > 0) {
          const { error } = await supabase
            .from("schedule_exceptions")
            .update({
              position_name: params.positionName,
              unit_number: params.unitNumber,
              notes: params.notes,
              partner_officer_id: params.partnerOfficerId,
              is_partnership: params.isPartnership
            })
            .eq("id", existingExceptions[0].id);
          
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("schedule_exceptions")
            .insert({
              officer_id: params.officerId,
              date: params.date,
              shift_type_id: params.shiftTypeId,
              is_off: false,
              position_name: params.positionName,
              unit_number: params.unitNumber,
              notes: params.notes,
              partner_officer_id: params.partnerOfficerId,
              is_partnership: params.isPartnership,
              custom_start_time: null,
              custom_end_time: null
            });
          
          if (error) throw error;
        }
      } else {
        // For exception officers
        const { error } = await supabase
          .from("schedule_exceptions")
          .update({
            position_name: params.positionName,
            unit_number: params.unitNumber,
            notes: params.notes,
            partner_officer_id: params.partnerOfficerId,
            is_partnership: params.isPartnership
          })
          .eq("id", params.scheduleId);
          
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Schedule updated");
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update schedule");
    },
  });

  const updatePartnershipMutation = useMutation({
    mutationFn: async ({ 
      officer, 
      partnerOfficerId, 
      action 
    }: { 
      officer: any; 
      partnerOfficerId?: string; 
      action: 'create' | 'remove' 
    }) => {
      console.log("🔄 Partnership mutation:", { officer, partnerOfficerId, action, officerData: officer });

      if (action === 'create' && partnerOfficerId) {
        // Validate inputs
        if (!officer.officerId || !partnerOfficerId) {
          throw new Error("Missing officer IDs for partnership");
        }

        // Update current officer with partner
        const updateData = {
          partner_officer_id: partnerOfficerId,
          is_partnership: true
        };

        let updatePromise;
        
        if (officer.type === "recurring") {
          updatePromise = supabase
            .from("recurring_schedules")
            .update(updateData)
            .eq("id", officer.scheduleId);
        } else {
          updatePromise = supabase
            .from("schedule_exceptions")
            .update(updateData)
            .eq("id", officer.scheduleId);
        }

        const { error, data } = await updatePromise;
        if (error) {
          console.error("Error updating officer partnership:", error);
          throw error;
        }

        // Also update the partner's record to create reciprocal relationship
        const partnerUpdateData = {
          partner_officer_id: officer.officerId,
          is_partnership: true
        };

        let partnerUpdatePromise;
        
        if (officer.type === "recurring") {
          // Find partner's recurring schedule
          const { data: partnerSchedule } = await supabase
            .from("recurring_schedules")
            .select("id")
            .eq("officer_id", partnerOfficerId)
            .eq("shift_type_id", officer.shift.id)
            .eq("day_of_week", officer.dayOfWeek)
            .single();

          if (!partnerSchedule) {
            throw new Error("Partner recurring schedule not found");
          }

          partnerUpdatePromise = supabase
            .from("recurring_schedules")
            .update(partnerUpdateData)
            .eq("id", partnerSchedule.id);
        } else {
          // For exceptions, use the date
          const { data: partnerSchedule } = await supabase
            .from("schedule_exceptions")
            .select("id")
            .eq("officer_id", partnerOfficerId)
            .eq("shift_type_id", officer.shift.id)
            .eq("date", officer.date)
            .single();

          if (!partnerSchedule) {
            throw new Error("Partner exception schedule not found");
          }

          partnerUpdatePromise = supabase
            .from("schedule_exceptions")
            .update(partnerUpdateData)
            .eq("id", partnerSchedule.id);
        }

        const { error: partnerError } = await partnerUpdatePromise;
        if (partnerError) {
          console.error("Error updating partner relationship:", partnerError);
          throw partnerError;
        }

      } else if (action === 'remove') {
        console.log("Removing partnership for officer:", officer.officerId);
        
        // Remove partnership from current officer
        const removeData = {
          partner_officer_id: null,
          is_partnership: false
        };

        // Remove from current officer
        let removePromise;
        
        if (officer.type === "recurring") {
          console.log("Removing from recurring schedule:", officer.scheduleId);
          removePromise = supabase
            .from("recurring_schedules")
            .update(removeData)
            .eq("id", officer.scheduleId);
        } else {
          console.log("Removing from exception schedule:", officer.scheduleId);
          removePromise = supabase
            .from("schedule_exceptions")
            .update(removeData)
            .eq("id", officer.scheduleId);
        }

        const { error, data } = await removePromise;
        if (error) {
          console.error("Error removing officer partnership:", error);
          throw error;
        }
        console.log("Successfully removed partnership from officer");

        // Remove from partner officer - CRITICAL FIX
        const actualPartnerOfficerId = officer.partnerOfficerId || officer.partnerData?.partnerOfficerId;
        if (actualPartnerOfficerId) {
          console.log("Removing partnership from partner officer:", actualPartnerOfficerId);

          let partnerRemovePromise;
          
          if (officer.type === "recurring") {
            // Find partner's recurring schedule for the same shift and day
            const { data: partnerSchedule, error: partnerFindError } = await supabase
              .from("recurring_schedules")
              .select("id")
              .eq("officer_id", actualPartnerOfficerId)
              .eq("shift_type_id", officer.shift.id)
              .eq("day_of_week", officer.dayOfWeek)
              .single();

            if (partnerFindError) {
              console.error("Error finding partner recurring schedule:", partnerFindError);
              // Don't throw - we still want to remove the primary officer's partnership
            } else if (partnerSchedule) {
              partnerRemovePromise = supabase
                .from("recurring_schedules")
                .update(removeData)
                .eq("id", partnerSchedule.id);
            }
          } else {
            // For exceptions, use the date
            const { data: partnerSchedule, error: partnerFindError } = await supabase
              .from("schedule_exceptions")
              .select("id")
              .eq("officer_id", actualPartnerOfficerId)
              .eq("shift_type_id", officer.shift.id)
              .eq("date", officer.date)
              .single();

            if (partnerFindError) {
              console.error("Error finding partner exception schedule:", partnerFindError);
              // Don't throw - we still want to remove the primary officer's partnership
            } else if (partnerSchedule) {
              partnerRemovePromise = supabase
                .from("schedule_exceptions")
                .update(removeData)
                .eq("id", partnerSchedule.id);
            }
          }

          if (partnerRemovePromise) {
            const { error: partnerError } = await partnerRemovePromise;
            if (partnerError) {
              console.error("Error removing partner relationship:", partnerError);
              // Don't throw - we still want to remove the primary officer's partnership
            } else {
              console.log("Successfully removed partnership from partner officer");
            }
          }
        } else {
          console.warn("No partnerOfficerId found for removal");
        }
      }
    },
    onSuccess: () => {
      if (action === 'remove') {
        toast.success("Partnership removed successfully");
      } else {
        toast.success("Partnership created successfully");
      }
      // Force refresh all relevant queries
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["weekly-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      
      // Add a small delay to ensure the backend has processed the changes
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
      }, 500);
    },
    onError: (error: any) => {
      console.error("Partnership mutation error:", error);
      toast.error(error.message || "Failed to update partnership");
    },
  });

  const addOfficerMutation = useMutation({
    mutationFn: async ({ 
      officerId, 
      shiftId, 
      position, 
      unitNumber, 
      notes,
      partnerOfficerId,
      isPartnership
    }: { 
      officerId: string; 
      shiftId: string; 
      position: string; 
      unitNumber?: string; 
      notes?: string;
      partnerOfficerId?: string;
      isPartnership?: boolean;
    }) => {
      const { data: existingExceptions, error: checkError } = await supabase
        .from("schedule_exceptions")
        .select("id")
        .eq("officer_id", officerId)
        .eq("date", dateStr)
        .eq("shift_type_id", shiftId)
        .eq("is_off", false);

      if (checkError) throw checkError;

      if (existingExceptions && existingExceptions.length > 0) {
        // Handle duplicates
        if (existingExceptions.length > 1) {
          const recordsToDelete = existingExceptions.slice(1);
          for (const record of recordsToDelete) {
            await supabase
              .from("schedule_exceptions")
              .delete()
              .eq("id", record.id);
          }
        }
        
        const { error } = await supabase
          .from("schedule_exceptions")
          .update({
            position_name: position,
            unit_number: unitNumber,
            notes: notes,
            partner_officer_id: partnerOfficerId,
            is_partnership: isPartnership,
            custom_start_time: null,
            custom_end_time: null
          })
          .eq("id", existingExceptions[0].id);
        
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("schedule_exceptions")
          .insert({
            officer_id: officerId,
            date: dateStr,
            shift_type_id: shiftId,
            is_off: false,
            position_name: position,
            unit_number: unitNumber,
            notes: notes,
            partner_officer_id: partnerOfficerId,
            is_partnership: isPartnership,
            custom_start_time: null,
            custom_end_time: null
          });
        
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Officer added to schedule");
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to add officer");
    },
  });

  const updatePTODetailsMutation = useMutation({
    mutationFn: async ({ 
      ptoId, 
      unitNumber, 
      notes 
    }: { 
      ptoId: string; 
      unitNumber?: string; 
      notes?: string; 
    }) => {
      const { error } = await supabase
        .from("schedule_exceptions")
        .update({ 
          unit_number: unitNumber,
          notes: notes
        })
        .eq("id", ptoId);
        
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("PTO details updated");
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update PTO details");
    },
  });

  const removeOfficerMutation = useMutation({
    mutationFn: async (officer: any) => {
      if (officer.type === "exception") {
        const { error } = await supabase
          .from("schedule_exceptions")
          .delete()
          .eq("id", officer.scheduleId);

        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Officer removed from daily schedule");
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to remove officer");
    },
  });

  const removePTOMutation = useMutation({
    mutationFn: async (ptoRecord: any) => {
      const calculateHours = (start: string, end: string) => {
        const [startHour, startMin] = start.split(":").map(Number);
        const [endHour, endMin] = end.split(":").map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;
        return (endMinutes - startMinutes) / 60;
      };

      const hoursUsed = calculateHours(ptoRecord.startTime, ptoRecord.endTime);
      const ptoColumn = PTO_TYPES.find((t) => t.value === ptoRecord.ptoType)?.column;
      
      if (ptoColumn) {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", ptoRecord.officerId)
          .single();

        if (profileError) throw profileError;

        const currentBalance = profile[ptoColumn as keyof typeof profile] as number;
        
        const { error: restoreError } = await supabase
          .from("profiles")
          .update({
            [ptoColumn]: currentBalance + hoursUsed,
          })
          .eq("id", ptoRecord.officerId);

        if (restoreError) throw restoreError;
      }

      const { error: deleteError } = await supabase
        .from("schedule_exceptions")
        .delete()
        .eq("id", ptoRecord.id);

      if (deleteError) throw deleteError;

      await supabase
        .from("schedule_exceptions")
        .delete()
        .eq("officer_id", ptoRecord.officerId)
        .eq("date", dateStr)
        .eq("shift_type_id", ptoRecord.shiftTypeId)
        .eq("is_off", false);
    },
    onSuccess: () => {
      toast.success("PTO removed and balance restored");
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["weekly-schedule"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to remove PTO");
    },
  });

  return {
    updateScheduleMutation,
    updatePTODetailsMutation,
    removeOfficerMutation,
    addOfficerMutation,
    removePTOMutation,
    updatePartnershipMutation
  };
};
