import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle, Bell, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils"; // Add this import

interface VacancyAlertsProps {
  userId: string;
  isAdminOrSupervisor: boolean;
}

export const VacancyAlerts = ({ userId, isAdminOrSupervisor }: VacancyAlertsProps) => {
  const queryClient = useQueryClient();

  // Fetch vacancy alerts with shift type information
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

  // Fetch user responses - FIXED: use alert_id instead of vacancy_alert_id
  const { data: userResponses } = useQuery({
    queryKey: ["vacancy-responses", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vacancy_responses")
        .select("alert_id, status")
        .eq("officer_id", userId);

      if (error) throw error;
      return data;
    },
    enabled: !!userId && !isAdminOrSupervisor,
  });

  // Fetch notifications for the current user
  const { data: notifications } = useQuery({
    queryKey: ["notifications", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select(`
          *,
          vacancy_alerts(
            date,
            shift_types(name)
          )
        `)
        .eq("officer_id", userId)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;
      return data;
    },
    enabled: !!userId,
  });

  // Mutation for responding to vacancies - FIXED: use alert_id
  const respondMutation = useMutation({
    mutationFn: async ({ alertId, status }: { alertId: string; status: string }) => {
      const { error } = await supabase.from("vacancy_responses").insert({
        alert_id: alertId, // Changed from vacancy_alert_id to alert_id
        officer_id: userId,
        status,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vacancy-responses"] });
      queryClient.invalidateQueries({ queryKey: ["vacancy-responses-admin"] }); // Also refresh admin view
      toast.success("Response submitted successfully");
    },
    onError: (error) => {
      toast.error("Failed to submit response: " + error.message);
    },
  });

  // Mutation for marking notifications as read
  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notificationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const getUserResponse = (alertId: string) => {
    return userResponses?.find((r) => r.alert_id === alertId); // Changed from vacancy_alert_id to alert_id
  };

  return (
    <div className="space-y-6">
      {/* Notifications Section */}
      {notifications && notifications.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-yellow-600" />
              New Alerts ({notifications.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className="flex items-center justify-between p-3 border border-yellow-200 rounded-lg bg-yellow-50"
                >
                  <div className="flex-1">
                    <p className="font-medium text-sm">{notification.title}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {notification.message}
                    </p>
                    {notification.vacancy_alerts && (
                      <Badge variant="outline" className="mt-2">
                        {format(new Date(notification.vacancy_alerts.date), "MMM d, yyyy")} - {notification.vacancy_alerts.shift_types?.name}
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => markAsReadMutation.mutate(notification.id)}
                    className="ml-2"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Vacancy Alerts Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Open Vacancy Alerts
          </CardTitle>
          <CardDescription>
            {isAdminOrSupervisor
              ? "Shifts that need coverage - officers will be notified automatically"
              : "Volunteer for open shifts to earn overtime"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading vacancy alerts...</p>
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
                      isStaffed 
                        ? "bg-green-50 border-green-200" 
                        : "bg-red-50 border-red-200"
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
                          <Badge 
                            variant={isStaffed ? "outline" : "destructive"}
                            className={isStaffed ? "bg-green-100" : ""}
                          >
                            {alert.current_staffing} / {alert.minimum_required} staffed
                          </Badge>
                          {isStaffed && (
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          )}
                        </div>
                        {/* Show custom message if exists */}
                        {alert.custom_message && (
                          <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded">
                            <p className="text-sm text-blue-800">{alert.custom_message}</p>
                          </div>
                        )}
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
                              disabled={respondMutation.isPending || isStaffed}
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
    </div>
  );
};
