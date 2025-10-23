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
    }) => {
      // First create the vacancy alert
      const { data: vacancy, error: vacancyError } = await supabase
        .from("vacancy_alerts")
        .insert([{
          ...vacancyData,
          status: "open"
        }])
        .select()
        .single();

      if (vacancyError) {
        console.error("Vacancy creation error:", vacancyError);
        throw vacancyError;
      }

      // Get shift type info for the notification
      const { data: shiftType, error: shiftError } = await supabase
        .from("shift_types")
        .select("name")
        .eq("id", vacancyData.shift_type_id)
        .single();

      if (shiftError) {
        console.error("Shift type fetch error:", shiftError);
        // Continue even if shift type fetch fails
      }

      // Get all officers to notify
      const { data: officers, error: officersError } = await supabase
        .from("profiles")
        .select("id")
        .eq("role", "officer");

      if (officersError) {
        console.error("Officers fetch error:", officersError);
        throw officersError;
      }

      // Create notifications for each officer individually
      if (officers && officers.length > 0) {
        const notifications = officers.map(officer => ({
          officer_id: officer.id,
          title: "New Vacancy Alert",
          message: `New shift vacancy for ${shiftType?.name || 'Unknown Shift'} on ${new Date(vacancyData.date).toLocaleDateString()}`,
          type: "vacancy",
          related_vacancy_id: vacancy.id,
        }));

        // Insert notifications in batches to avoid overwhelming the database
        const batchSize = 10;
        for (let i = 0; i < notifications.length; i += batchSize) {
          const batch = notifications.slice(i, i + batchSize);
          const { error: notifyError } = await supabase
            .from("notifications")
            .insert(batch);

          if (notifyError) {
            console.error(`Notification batch ${i/batchSize + 1} error:`, notifyError);
            // Continue with other batches even if one fails
          }
        }
      }

      return vacancy;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vacancy-alerts"] });
      toast.success("Vacancy alert created and notifications sent");
    },
    onError: (error: any) => {
      console.error("Create vacancy error:", error);
      toast.error("Failed to create vacancy alert: " + error.message);
    },
  });
};
