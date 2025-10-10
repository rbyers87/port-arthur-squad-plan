import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const usePositionMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ scheduleId, type, positionName }: { 
      scheduleId: string; 
      type: "recurring" | "exception";
      positionName: string;
    }) => {
      const table = type === "recurring" ? "recurring_schedules" : "schedule_exceptions";
      
      const { error } = await supabase
        .from(table)
        .update({ 
          position_name: positionName
        })
        .eq("id", scheduleId);
        
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Position updated");
      // Force refresh all schedule queries
      queryClient.invalidateQueries({ 
        predicate: (query) => 
          query.queryKey[0] === "daily-schedule" || 
          query.queryKey[0] === "weekly-schedule"
      });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update position");
    },
  });
};
