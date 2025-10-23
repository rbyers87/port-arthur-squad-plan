import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const useCreateVacancyAlert = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vacancyData: {
      shift_type_id: string;
      date: string;
      current_staffing: number;
      minimum_required: number;
      custom_message?: string;
    }) => {
      console.log("Creating vacancy alert via function:", vacancyData);

      // Use the database function that bypasses RLS
      const { data: vacancyId, error } = await supabase.rpc('create_vacancy_alert_with_notifications', {
        p_shift_type_id: vacancyData.shift_type_id,
        p_date: vacancyData.date,
        p_current_staffing: vacancyData.current_staffing,
        p_minimum_required: vacancyData.minimum_required,
        p_custom_message: vacancyData.custom_message || null
      });

      if (error) {
        console.error("Database function error:", error);
        throw error;
      }

      console.log("Vacancy created successfully with ID:", vacancyId);

      // Fetch the complete vacancy data to return
      const { data: vacancy, error: fetchError } = await supabase
        .from("vacancy_alerts")
        .select("*, shift_types(name, start_time, end_time)")
        .eq("id", vacancyId)
        .single();

      if (fetchError) {
        console.error("Error fetching created vacancy:", fetchError);
        throw fetchError;
      }

      return vacancy;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vacancy-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["understaffed-shifts"] });
      queryClient.invalidateQueries({ queryKey: ["all-vacancy-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["existing-vacancy-alerts"] });
      toast.success("Vacancy alert created and notifications sent to all officers");
    },
    onError: (error: any) => {
      console.error("Create vacancy error:", error);
      toast.error("Failed to create vacancy alert: " + error.message);
    },
  });
};
