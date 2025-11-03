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
              notes: params.notes
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
            notes: params.notes
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

  const addOfficerMutation = useMutation({
    mutationFn: async ({ 
      officerId, 
      shiftId, 
      position, 
      unitNumber, 
      notes 
    }: { 
      officerId: string; 
      shiftId: string; 
      position: string; 
      unitNumber?: string; 
      notes?: string 
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
    removePTOMutation
  };
};
