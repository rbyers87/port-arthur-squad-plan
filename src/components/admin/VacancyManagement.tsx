// components/admin/VacancyManagement.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon, Plus, Users, AlertTriangle, Mail } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

const UnderstaffedDetection = () => {
  const queryClient = useQueryClient();

  const { data: understaffedShifts, isLoading, error } = useQuery({
    queryKey: ["understaffed-shifts-detection"],
    queryFn: async () => {
      console.log("Starting understaffed shift detection...");
      
      // Get dates for the next 7 days
      const dates = [];
      const today = new Date();
      
      for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        dates.push({
          date: date.toISOString().split('T')[0],
          dayOfWeek: date.getDay()
        });
      }

      console.log("Checking dates:", dates);

      try {
        const allUnderstaffedShifts = [];

        // Check each date in the next 7 days
        for (const { date, dayOfWeek } of dates) {
          console.log(`Checking date: ${date}, dayOfWeek: ${dayOfWeek}`);

          // Get all shift types
          const { data: shiftTypes, error: shiftError } = await supabase
            .from("shift_types")
            .select("*")
            .order("start_time");
          if (shiftError) throw shiftError;

          // Get minimum staffing requirements for this day of week
          const { data: minimumStaffing, error: minError } = await supabase
            .from("minimum_staffing")
            .select("minimum_officers, minimum_supervisors, shift_type_id")
            .eq("day_of_week", dayOfWeek);
          if (minError) throw minError;

          // Get recurring schedules for this day of week
          const { data: recurringData, error: recurringError } = await supabase
            .from("recurring_schedules")
            .select(`
              *,
              profiles!inner (
                id, 
                full_name, 
                badge_number, 
                rank
              ),
              shift_types (
                id, 
                name, 
                start_time, 
                end_time
              )
            `)
            .eq("day_of_week", dayOfWeek)
            .is("end_date", null);

          if (recurringError) {
            console.error("Recurring schedules error:", recurringError);
            throw recurringError;
          }

          // Get schedule exceptions for this specific date
          const { data: exceptionsData, error: exceptionsError } = await supabase
            .from("schedule_exceptions")
            .select(`
              *,
              profiles!inner (
                id, 
                full_name, 
                badge_number, 
                rank
              ),
              shift_types (
                id, 
                name, 
                start_time, 
                end_time
              )
            `)
            .eq("date", date);

          if (exceptionsError) {
            console.error("Schedule exceptions error:", exceptionsError);
            throw exceptionsError;
          }

          // Separate PTO exceptions from regular exceptions
          const ptoExceptions = exceptionsData?.filter(e => e.is_off) || [];
          const workingExceptions = exceptionsData?.filter(e => !e.is_off) || [];

          // Check each shift type for understaffing
          for (const shift of shiftTypes) {
            const minStaff = minimumStaffing?.find(m => m.shift_type_id === shift.id);
            const minSupervisors = minStaff?.minimum_supervisors || 1;
            const minOfficers = minStaff?.minimum_officers || 0;

            // Get recurring officers for this shift
            const recurringOfficers = recurringData
              ?.filter(r => r.shift_types?.id === shift.id)
              .map(r => {
                // Check if this officer has PTO for today
                const ptoException = ptoExceptions?.find(e => 
                  e.officer_id === r.officer_id && e.shift_types?.id === shift.id
                );

                // Skip officers with full-day PTO
                if (ptoException?.is_off && !ptoException.custom_start_time && !ptoException.custom_end_time) {
                  return null;
                }

                return {
                  officerId: r.officer_id,
                  isSupervisor: r.position_name?.toLowerCase().includes('supervisor')
                };
              })
              .filter(officer => officer !== null) || [];

            // Get additional officers from working exceptions
            const additionalOfficers = workingExceptions
              ?.filter(e => 
                e.shift_types?.id === shift.id &&
                !recurringData?.some(r => r.officer_id === e.officer_id)
              )
              .map(e => {
                // Check if this officer has PTO for today
                const ptoException = ptoExceptions?.find(p => 
                  p.officer_id === e.officer_id && p.shift_types?.id === shift.id
                );

                // Skip officers with full-day PTO
                if (ptoException?.is_off && !ptoException.custom_start_time && !ptoException.custom_end_time) {
                  return null;
                }

                return {
                  officerId: e.officer_id,
                  isSupervisor: e.position_name?.toLowerCase().includes('supervisor')
                };
              })
              .filter(officer => officer !== null) || [];

            const allOfficers = [...recurringOfficers, ...additionalOfficers];
            
            // Count supervisors and officers
            const currentSupervisors = allOfficers.filter(o => o.isSupervisor).length;
            const currentOfficers = allOfficers.filter(o => !o.isSupervisor).length;

            const supervisorsUnderstaffed = currentSupervisors < minSupervisors;
            const officersUnderstaffed = currentOfficers < minOfficers;
            const isUnderstaffed = supervisorsUnderstaffed || officersUnderstaffed;

            if (isUnderstaffed) {
              console.log("Understaffed shift found:", {
                date,
                shift: shift.name,
                supervisors: `${currentSupervisors}/${minSupervisors}`,
                officers: `${currentOfficers}/${minOfficers}`,
                dayOfWeek
              });

              allUnderstaffedShifts.push({
                date,
                shift_type_id: shift.id,
                shift_types: shift,
                current_staffing: currentSupervisors + currentOfficers,
                minimum_required: minSupervisors + minOfficers,
                current_supervisors: currentSupervisors,
                current_officers: currentOfficers,
                min_supervisors: minSupervisors,
                min_officers: minOfficers,
                day_of_week: dayOfWeek,
                isSupervisorsUnderstaffed: supervisorsUnderstaffed,
                isOfficersUnderstaffed: officersUnderstaffed
              });
            }
          }
        }

        console.log("Total understaffed shifts found:", allUnderstaffedShifts.length);
        return allUnderstaffedShifts;

      } catch (err) {
        console.error("Error in understaffed detection:", err);
        throw err;
      }
    },
  });

  const { data: existingAlerts } = useQuery({
    queryKey: ["existing-vacancy-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vacancy_alerts")
        .select("*")
        .eq("status", "open");

      if (error) throw error;
      return data;
    },
  });

  const createAlertMutation = useMutation({
  mutationFn: async (shiftData: any) => {
    // Check if alert already exists
    const existingAlert = existingAlerts?.find(alert => 
      alert.date === shiftData.date && 
      alert.shift_type_id === shiftData.shift_type_id
    );

    if (existingAlert) {
      throw new Error("Alert already exists for this shift");
    }

    const { data, error } = await supabase
      .from("vacancy_alerts")
      .insert({
        date: shiftData.date,
        shift_type_id: shiftData.shift_type_id,
        current_staffing: shiftData.current_staffing,
        minimum_required: shiftData.minimum_required,
        status: "open",
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["existing-vacancy-alerts"] });
    queryClient.invalidateQueries({ queryKey: ["all-vacancy-alerts"] });
    toast.success("Vacancy alert created successfully");
  },
  onError: (error) => {
    toast.error("Failed to create alert: " + error.message);
  },
});

  const sendAlertMutation = useMutation({
  mutationFn: async (alertData: any) => {
    // Get all officers who have text notifications enabled
    const { data: officers, error: officersError } = await supabase
      .from("profiles")
      .select("id, email, phone, notification_preferences")
      .eq("notification_preferences->>receiveTexts", "true");

    if (officersError) throw officersError;

    // Send email notifications to all officers
    const emailPromises = officers?.map(async (officer) => {
      return fetch('https://ywghefarrcwbnraqyfgk.supabase.co/functions/v1/send-vacancy-alert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: officer.email,
          subject: `Vacancy Alert - ${format(new Date(alertData.date), "MMM d, yyyy")} - ${alertData.shift_types.name}`,
          message: `A shift vacancy has been identified:\n\nDate: ${format(new Date(alertData.date), "EEEE, MMM d, yyyy")}\nShift: ${alertData.shift_types.name} (${alertData.shift_types.start_time} - ${alertData.shift_types.end_time})\nCurrent Staffing: ${alertData.current_staffing} / ${alertData.minimum_required}\n\nPlease sign up if available.`,
          alertId: alertData.alertId
        }),
      });
    }) || [];

    // Send text notifications to officers with phone numbers and text preferences
    const textPromises = officers
      ?.filter(officer => officer.phone && officer.notification_preferences?.receiveTexts)
      .map(async (officer) => {
        return fetch('https://ywghefarrcwbnraqyfgk.supabase.co/functions/v1/send-text-alert', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: officer.phone,
            message: `Vacancy Alert: ${format(new Date(alertData.date), "MMM d")} - ${alertData.shift_types.name}. Current: ${alertData.current_staffing}/${alertData.minimum_required}. Sign up if available.`
          }),
        });
      }) || [];

    await Promise.all([...emailPromises, ...textPromises]);
    
    // Update alert status to indicate notification was sent
    const { error } = await supabase
      .from("vacancy_alerts")
      .update({ notification_sent: true })
      .eq("id", alertData.alertId);

    if (error) throw error;
  },
  onSuccess: () => {
    toast.success("Alerts sent successfully to all officers");
    queryClient.invalidateQueries({ queryKey: ["existing-vacancy-alerts"] });
  },
  onError: (error) => {
    toast.error("Failed to send alerts: " + error.message);
  },
});

  const isAlertCreated = (shift: any) => {
    return existingAlerts?.some(alert => 
      alert.date === shift.date && 
      alert.shift_type_id === shift.shift_type_id
    );
  };

  const handleCreateAlert = (shift: any) => {
    createAlertMutation.mutate(shift);
  };

  const handleCreateAllAlerts = () => {
    if (!understaffedShifts) return;

    const shiftsWithoutAlerts = understaffedShifts.filter(shift => !isAlertCreated(shift));
    
    shiftsWithoutAlerts.forEach(shift => {
      createAlertMutation.mutate(shift);
    });

    if (shiftsWithoutAlerts.length === 0) {
      toast.info("All understaffed shifts already have alerts");
    } else {
      toast.success(`Created ${shiftsWithoutAlerts.length} alerts`);
    }
  };

  const handleSendAlert = (shift: any) => {
    const alert = existingAlerts?.find(a => 
      a.date === shift.date && a.shift_type_id === shift.shift_type_id
    );

    if (!alert) {
      toast.error("Please create an alert first");
      return;
    }

    sendAlertMutation.mutate({
      ...shift,
      alertId: alert.id
    });
  };

  if (error) {
    console.error("Query error:", error);
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-red-600">
            Error loading understaffed shifts: {error.message}
          </div>
          <div className="text-center text-sm text-muted-foreground mt-2">
            Check console for details
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">Scanning for understaffed shifts...</div>
        </CardContent>
      </Card>
    );
  }

  return (
  <Card>
    <CardHeader>
      <div className="flex items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Automatic Understaffed Shift Detection
          </CardTitle>
          <CardDescription>
            Automatically detect shifts with insufficient staffing based on minimum staffing requirements
          </CardDescription>
        </div>
        <Button
          variant="outline"
          onClick={handleCreateAllAlerts}
          disabled={createAlertMutation.isPending || !understaffedShifts?.length}
        >
          <Plus className="h-4 w-4 mr-2" />
          Create All Alerts
        </Button>
      </div>
    </CardHeader>
    <CardContent>
      {!understaffedShifts || understaffedShifts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No understaffed shifts found in the next 7 days.</p>
      ) : (
        <div className="space-y-4">
          {understaffedShifts.map((shift, index) => {
            const alertExists = isAlertCreated(shift);

            return (
              <div
                key={`${shift.date}-${shift.shift_type_id}-${index}`}
                className="p-4 border rounded-lg space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="font-medium">{shift.shift_types?.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(shift.date), "EEEE, MMM d, yyyy")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {shift.shift_types?.start_time} - {shift.shift_types?.end_time}
                    </p>
                    
                    {/* REPLACE THIS SECTION */}
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="destructive" className="block">
                        Total Staffing: {shift.current_staffing} / {shift.minimum_required}
                      </Badge>
                      {shift.isSupervisorsUnderstaffed && (
                        <Badge variant="destructive" className="block">
                          Needs {shift.min_supervisors - shift.current_supervisors} more supervisor(s)
                        </Badge>
                      )}
                      {shift.isOfficersUnderstaffed && (
                        <Badge variant="destructive" className="block">
                          Needs {shift.min_officers - shift.current_officers} more officer(s)
                        </Badge>
                      )}
                      {alertExists && (
                        <Badge variant="outline" className="bg-green-500/10 text-green-700">
                          Alert Created
                        </Badge>
                      )}
                    </div>
                    {/* END OF REPLACEMENT SECTION */}
                    
                  </div>
                  <div className="flex flex-col gap-2">
                    {!alertExists ? (
                      <Button
                        size="sm"
                        onClick={() => handleCreateAlert(shift)}
                        disabled={createAlertMutation.isPending}
                      >
                        Create Alert
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleSendAlert(shift)}
                        disabled={sendAlertMutation.isPending}
                      >
                        <Mail className="h-3 w-3 mr-1" />
                        Send Alert
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </CardContent>
  </Card>
);

export const VacancyManagement = () => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedShift, setSelectedShift] = useState<string>();
  const [minimumRequired, setMinimumRequired] = useState<string>("2");
  const queryClient = useQueryClient();

  const { data: shiftTypes } = useQuery({
    queryKey: ["shift-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_types")
        .select("*")
        .order("start_time");
      if (error) throw error;
      return data;
    },
  });

  const { data: alerts } = useQuery({
    queryKey: ["all-vacancy-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vacancy_alerts")
        .select(`
          *,
          shift_types(name, start_time, end_time)
        `)
        .order("date", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const { data: responses } = useQuery({
    queryKey: ["vacancy-responses-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vacancy_responses")
        .select(`
          *,
          profiles(full_name, badge_number),
          vacancy_alerts(date, shift_types(name))
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createAlertMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDate || !selectedShift) {
        throw new Error("Please select date and shift");
      }

      const { error } = await supabase.from("vacancy_alerts").insert({
        date: format(selectedDate, "yyyy-MM-dd"),
        shift_type_id: selectedShift,
        minimum_required: parseInt(minimumRequired),
        current_staffing: 0,
        status: "open",
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-vacancy-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["vacancy-alerts"] });
      toast.success("Vacancy alert created");
      setDialogOpen(false);
      setSelectedDate(undefined);
      setSelectedShift(undefined);
      setMinimumRequired("2");
    },
    onError: (error: Error) => {
      toast.error("Failed to create alert: " + error.message);
    },
  });

  const closeAlertMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase
        .from("vacancy_alerts")
        .update({ status: "closed" })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-vacancy-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["vacancy-alerts"] });
      toast.success("Alert closed");
    },
  });

  return (
    <div className="space-y-6">
      {/* Automatic Understaffed Detection */}
      <UnderstaffedDetection />

      {/* Manual Alert Creation */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Manual Vacancy Alert Creation</CardTitle>
              <CardDescription>Manually create vacancy alerts for specific shifts</CardDescription>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Manual Alert
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Vacancy Alert</DialogTitle>
                  <DialogDescription>
                    Create an alert to request volunteers for an understaffed shift
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !selectedDate && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {selectedDate ? format(selectedDate, "PPP") : <span>Pick a date</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={selectedDate}
                          onSelect={setSelectedDate}
                          initialFocus
                          className="pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="space-y-2">
                    <Label>Shift Type</Label>
                    <Select value={selectedShift} onValueChange={setSelectedShift}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select shift" />
                      </SelectTrigger>
                      <SelectContent>
                        {shiftTypes?.map((shift) => (
                          <SelectItem key={shift.id} value={shift.id}>
                            {shift.name} ({shift.start_time} - {shift.end_time})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Minimum Required Officers</Label>
                    <Input
                      type="number"
                      min="1"
                      value={minimumRequired}
                      onChange={(e) => setMinimumRequired(e.target.value)}
                    />
                  </div>

                  <Button
                    className="w-full"
                    onClick={() => createAlertMutation.mutate()}
                    disabled={createAlertMutation.isPending}
                  >
                    {createAlertMutation.isPending ? "Creating..." : "Create Alert"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {!alerts || alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No vacancy alerts created yet.</p>
            ) : (
              alerts.map((alert) => (
                <div key={alert.id} className="p-4 border rounded-lg space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium">{alert.shift_types?.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(alert.date), "EEEE, MMM d, yyyy")}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Staffing: {alert.current_staffing} / {alert.minimum_required}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span
                        className={cn(
                          "text-xs px-2 py-1 rounded",
                          alert.status === "open"
                            ? "bg-green-500/10 text-green-700"
                            : "bg-gray-500/10 text-gray-700"
                        )}
                      >
                        {alert.status}
                      </span>
                      {alert.status === "open" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => closeAlertMutation.mutate(alert.id)}
                        >
                          Close Alert
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Officer Responses */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Officer Responses
          </CardTitle>
          <CardDescription>View who has responded to vacancy alerts</CardDescription>
        </CardHeader>
        <CardContent>
          {!responses || responses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No responses yet.</p>
          ) : (
            <div className="space-y-3">
              {responses.map((response) => (
                <div key={response.id} className="p-3 border rounded-lg flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {response.profiles?.full_name} (#{response.profiles?.badge_number})
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {response.vacancy_alerts?.shift_types?.name} -{" "}
                      {format(new Date(response.vacancy_alerts?.date || ""), "MMM d, yyyy")}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "text-xs px-2 py-1 rounded capitalize",
                      response.status === "interested"
                        ? "bg-green-500/10 text-green-700"
                        : "bg-red-500/10 text-red-700"
                    )}
                  >
                    {response.status.replace("_", " ")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
