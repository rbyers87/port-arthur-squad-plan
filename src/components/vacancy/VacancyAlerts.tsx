import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface VacancyAlertsProps {
  userId: string;
  isAdminOrSupervisor: boolean;
}

export const VacancyAlerts = ({ userId, isAdminOrSupervisor }: VacancyAlertsProps) => {
  const queryClient = useQueryClient();

  const { data: alerts, isLoading } = useQuery({
    queryKey: ["vacancy-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vacancy_alerts")
        .select(`
          *,
          shift_types(name, start_time, end_time)
        `)
        .eq("status", "open")
        .order("date", { ascending: true });

      if (error) throw error;
      return data;
    },
  });

  const { data: userResponses } = useQuery({
    queryKey: ["vacancy-responses", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vacancy_responses")
        .select("vacancy_alert_id, status")
        .eq("officer_id", userId);

      if (error) throw error;
      return data;
    },
    enabled: !isAdminOrSupervisor,
  });

  const respondMutation = useMutation({
    mutationFn: async ({ alertId, status }: { alertId: string; status: string }) => {
      const { error } = await supabase.from("vacancy_responses").insert({
        vacancy_alert_id: alertId,
        officer_id: userId,
        status,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vacancy-responses"] });
      toast.success("Response submitted");
    },
    onError: (error) => {
      toast.error("Failed to submit response: " + error.message);
    },
  });

  const getUserResponse = (alertId: string) => {
    return userResponses?.find((r) => r.vacancy_alert_id === alertId);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Open Vacancy Alerts
        </CardTitle>
        <CardDescription>
          {isAdminOrSupervisor
            ? "Shifts that need coverage"
            : "Volunteer for open shifts to earn overtime"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : !alerts || alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open vacancies at this time.</p>
        ) : (
          <div className="space-y-4">
            {alerts.map((alert) => {
              const userResponse = getUserResponse(alert.id);
              const isStaffed = alert.current_staffing >= alert.minimum_required;

              return (
                <div
                  key={alert.id}
                  className={cn(
                    "p-4 border rounded-lg space-y-3",
                    isStaffed && "bg-green-500/5 border-green-500/20"
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <p className="font-medium">{alert.shift_types?.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(alert.date), "EEEE, MMM d, yyyy")}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {alert.shift_types?.start_time} - {alert.shift_types?.end_time}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant={isStaffed ? "outline" : "destructive"}>
                          {alert.current_staffing} / {alert.minimum_required} staffed
                        </Badge>
                        {isStaffed && (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        )}
                      </div>
                    </div>
                  </div>

                  {!isAdminOrSupervisor && (
                    <div className="flex gap-2">
                      {userResponse ? (
                        <Badge variant="outline" className="capitalize">
                          You responded: {userResponse.status}
                        </Badge>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            onClick={() =>
                              respondMutation.mutate({
                                alertId: alert.id,
                                status: "interested",
                              })
                            }
                            disabled={respondMutation.isPending}
                          >
                            I'm Available
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              respondMutation.mutate({
                                alertId: alert.id,
                                status: "not_available",
                              })
                            }
                            disabled={respondMutation.isPending}
                          >
                            Not Available
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
