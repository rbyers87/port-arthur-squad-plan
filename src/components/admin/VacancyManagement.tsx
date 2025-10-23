// components/admin/VacancyManagement.tsx
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon, Plus, Users, RefreshCw, AlertTriangle, Mail } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useCreateVacancyAlert } from "@/hooks/useCreateVacancyAlert";

export const VacancyManagement = () => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedShift, setSelectedShift] = useState<string>();
  const [minimumRequired, setMinimumRequired] = useState<string>("2");
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [selectedShiftId, setSelectedShiftId] = useState<string>("all");
  const queryClient = useQueryClient();
  const [customMessage, setCustomMessage] = useState("");

  // Add real-time subscription for vacancy alerts
  useEffect(() => {
    const subscription = supabase
      .channel('vacancy-alerts-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vacancy_alerts'
        },
        () => {
          // Invalidate and refetch when any changes occur
          queryClient.invalidateQueries({ queryKey: ["all-vacancy-alerts"] });
          queryClient.invalidateQueries({ queryKey: ["vacancy-alerts"] });
          setLastRefreshed(new Date());
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [queryClient]);

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

  const { data: alerts, isLoading: alertsLoading, refetch: refetchAlerts } = useQuery({
    queryKey: ["all-vacancy-alerts"],
    queryFn: async () => {
      console.log("🔄 Fetching vacancy alerts...");
      
      // Fetch vacancy alerts with proper join
      const { data: alertsData, error } = await supabase
        .from("vacancy_alerts")
        .select(`
          *,
          shift_types (
            id, 
            name, 
            start_time, 
            end_time
          )
        `)
        .order("date", { ascending: false })
        .limit(20);
      
      if (error) {
        console.error("Error fetching vacancy alerts:", error);
        throw error;
      }
      
      return alertsData;
    },
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
  });

  const { data: responses, refetch: refetchResponses } = useQuery({
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

  // Understaffed Detection Query - FIXED to handle null positions properly
  const { 
    data: understaffedShifts, 
    isLoading: understaffedLoading, 
    error: understaffedError,
    refetch: refetchUnderstaffed
  } = useQuery({
    queryKey: ["understaffed-shifts-detection", selectedShiftId],
    queryFn: async () => {
      console.log("🔍 Starting understaffed shift detection...");
      
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

      try {
        const allUnderstaffedShifts = [];

        // Check each date in the next 7 days
        for (const { date, dayOfWeek } of dates) {
          console.log(`\n📋 Checking date: ${date}, dayOfWeek: ${dayOfWeek}`);

          // Get all shift types or just the selected one
          let shiftTypesToCheck;
          if (selectedShiftId === "all") {
            const { data, error: shiftError } = await supabase
              .from("shift_types")
              .select("*")
              .order("start_time");
            if (shiftError) throw shiftError;
            shiftTypesToCheck = data;
          } else {
            const { data, error: shiftError } = await supabase
              .from("shift_types")
              .select("*")
              .eq("id", selectedShiftId);
            if (shiftError) throw shiftError;
            shiftTypesToCheck = data;
          }

          console.log(`🔄 Checking ${shiftTypesToCheck?.length} shifts for ${date}`);

          // Get minimum staffing requirements for this day of week
          const { data: minimumStaffing, error: minError } = await supabase
            .from("minimum_staffing")
            .select("minimum_officers, minimum_supervisors, shift_type_id")
            .eq("day_of_week", dayOfWeek);
          if (minError) throw minError;

          console.log("📊 Minimum staffing requirements:", minimumStaffing);

          // Get ALL schedule data for this date - USING THE SAME LOGIC AS DailyScheduleView
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
            console.error("❌ Recurring schedules error:", recurringError);
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
            console.error("❌ Schedule exceptions error:", exceptionsError);
            throw exceptionsError;
          }

          // Separate PTO exceptions from regular exceptions
          const ptoExceptions = exceptionsData?.filter(e => e.is_off) || [];
          const workingExceptions = exceptionsData?.filter(e => !e.is_off) || [];

          console.log(`📝 Total exceptions: ${exceptionsData?.length || 0} (PTO: ${ptoExceptions.length}, Working: ${workingExceptions.length})`);

          // Check each shift type for understaffing
          for (const shift of shiftTypesToCheck || []) {
            const minStaff = minimumStaffing?.find(m => m.shift_type_id === shift.id);
            const minSupervisors = minStaff?.minimum_supervisors || 1;
            const minOfficers = minStaff?.minimum_officers || 8;

            console.log(`\n🔍 Checking shift: ${shift.name} (${shift.start_time} - ${shift.end_time})`);
            console.log(`📋 Min requirements: ${minSupervisors} supervisors, ${minOfficers} officers`);

            // Build the schedule exactly like DailyScheduleView does
            const allAssignedOfficers = [];

            // Process recurring officers - check if they have working exceptions that override their position
            const recurringOfficers = recurringData
              ?.filter(r => r.shift_types?.id === shift.id) || [];

            for (const recurringOfficer of recurringOfficers) {
              // Check if this officer has a working exception for today that overrides their position
              const workingException = workingExceptions?.find(e => 
                e.officer_id === recurringOfficer.officer_id && 
                e.shift_types?.id === shift.id
              );

              // Check if this officer has PTO for today
              const ptoException = ptoExceptions?.find(e => 
                e.officer_id === recurringOfficer.officer_id && 
                e.shift_types?.id === shift.id
              );

              // Skip officers with full-day PTO
              if (ptoException?.is_off && !ptoException.custom_start_time && !ptoException.custom_end_time) {
                console.log(`➖ Skipping ${recurringOfficer.profiles?.full_name} - Full day PTO`);
                continue;
              }

              // Use the position from the working exception if it exists, otherwise use recurring position
              const actualPosition = workingException?.position_name || recurringOfficer.position_name;
              
              // FIXED: Better supervisor detection that handles null/undefined positions
              const isSupervisor = actualPosition ? 
                actualPosition.toLowerCase().includes('supervisor') : 
                false;

              console.log(`✅ ${recurringOfficer.profiles?.full_name} - Position: ${actualPosition || 'No position'} - ${isSupervisor ? 'Supervisor' : 'Officer'} - ${workingException ? 'Exception Override' : 'Recurring'}`);

              allAssignedOfficers.push({
                officerId: recurringOfficer.officer_id,
                name: recurringOfficer.profiles?.full_name,
                position: actualPosition,
                isSupervisor: isSupervisor,
                type: workingException ? 'exception' : 'recurring'
              });
            }

            // Process additional officers from working exceptions (manually added shifts)
            const additionalOfficers = workingExceptions
              ?.filter(e => 
                e.shift_types?.id === shift.id &&
                !recurringData?.some(r => r.officer_id === e.officer_id)
              ) || [];

            for (const additionalOfficer of additionalOfficers) {
              // Check if this officer has PTO for today
              const ptoException = ptoExceptions?.find(p => 
                p.officer_id === additionalOfficer.officer_id && 
                p.shift_types?.id === shift.id
              );

              // Skip officers with full-day PTO
              if (ptoException?.is_off && !ptoException.custom_start_time && !ptoException.custom_end_time) {
                console.log(`➖ Skipping ${additionalOfficer.profiles?.full_name} - Full day PTO (Added Shift)`);
                continue;
              }

              // FIXED: Better supervisor detection that handles null/undefined positions
              const isSupervisor = additionalOfficer.position_name ? 
                additionalOfficer.position_name.toLowerCase().includes('supervisor') : 
                false;
              
              console.log(`✅ ${additionalOfficer.profiles?.full_name} - Position: ${additionalOfficer.position_name || 'No position'} - ${isSupervisor ? 'Supervisor' : 'Officer'} - Added Shift`);

              allAssignedOfficers.push({
                officerId: additionalOfficer.officer_id,
                name: additionalOfficer.profiles?.full_name,
                position: additionalOfficer.position_name,
                isSupervisor: isSupervisor,
                type: 'added'
              });
            }

            // Count supervisors and officers based on ACTUAL assigned positions
            const currentSupervisors = allAssignedOfficers.filter(o => o.isSupervisor).length;
            const currentOfficers = allAssignedOfficers.filter(o => !o.isSupervisor).length;

            console.log(`👥 Final staffing: ${currentSupervisors} supervisors, ${currentOfficers} officers`);
            console.log(`📋 All assigned officers:`, allAssignedOfficers.map(o => ({
              name: o.name,
              position: o.position,
              isSupervisor: o.isSupervisor,
              type: o.type
            })));

            const supervisorsUnderstaffed = currentSupervisors < minSupervisors;
            const officersUnderstaffed = currentOfficers < minOfficers;
            const isUnderstaffed = supervisorsUnderstaffed || officersUnderstaffed;

            console.log(`🚨🚨🚨 FINAL CHECK for ${shift.name} on ${date}:`, {
              currentSupervisors,
              currentOfficers,
              minSupervisors,
              minOfficers,
              isUnderstaffed,
              assignedOfficers: allAssignedOfficers.map(o => ({
                name: o.name,
                position: o.position,
                isSupervisor: o.isSupervisor
              }))
            });

            if (isUnderstaffed) {
              console.log("🚨 UNDERSTAFFED SHIFT FOUND:", {
                date,
                shift: shift.name,
                supervisors: `${currentSupervisors}/${minSupervisors}`,
                officers: `${currentOfficers}/${minOfficers}`,
                dayOfWeek
              });

              const shiftData = {
                date,
                shift_type_id: shift.id,
                shift_types: {
                  id: shift.id,
                  name: shift.name,
                  start_time: shift.start_time,
                  end_time: shift.end_time
                },
                current_staffing: currentSupervisors + currentOfficers,
                minimum_required: minSupervisors + minOfficers,
                current_supervisors: currentSupervisors,
                current_officers: currentOfficers,
                min_supervisors: minSupervisors,
                min_officers: minOfficers,
                day_of_week: dayOfWeek,
                isSupervisorsUnderstaffed: supervisorsUnderstaffed,
                isOfficersUnderstaffed: officersUnderstaffed,
                assigned_officers: allAssignedOfficers.map(o => ({
                  name: o.name,
                  position: o.position,
                  isSupervisor: o.isSupervisor,
                  type: o.type
                }))
              };

              console.log("📊 Storing understaffed shift data:", shiftData);
              allUnderstaffedShifts.push(shiftData);
            } else {
              console.log("✅ Shift is properly staffed");
            }
          }
        }

        console.log("🎯 Total understaffed shifts found:", allUnderstaffedShifts.length);
        return allUnderstaffedShifts;

      } catch (err) {
        console.error("❌ Error in understaffed detection:", err);
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

  const handleRefreshAll = () => {
    refetchAlerts();
    refetchResponses();
    refetchUnderstaffed();
    setLastRefreshed(new Date());
    toast.success("Data refreshed");
  };

  // Use the new hook for creating vacancy alerts
const createAlertMutation = useCreateVacancyAlert();

// Add this function to handle manual alert creation
const handleCreateManualAlert = () => {
  if (!selectedDate || !selectedShift) {
    toast.error("Please select date and shift");
    return;
  }

  createAlertMutation.mutate({
    shift_type_id: selectedShift,
    date: format(selectedDate, "yyyy-MM-dd"),
    current_staffing: 0,
    minimum_required: parseInt(minimumRequired)
  }, {
    onSuccess: () => {
      setDialogOpen(false);
      setSelectedDate(undefined);
      setSelectedShift(undefined);
      setMinimumRequired("2");
    }
  });
};

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
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success("Alert closed");
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

  const handleCreateAlertFromDetection = (shift: any) => {
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

  return (
    <div className="space-y-6">
      {/* Refresh Button */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Vacancy Management</h2>
          <p className="text-sm text-muted-foreground">
            Last refreshed: {lastRefreshed.toLocaleTimeString()}
          </p>
        </div>
        <Button variant="outline" onClick={handleRefreshAll}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh All
        </Button>
      </div>

      {/* Automatic Understaffed Detection */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Automatic Understaffed Shift Detection
              </CardTitle>
              <CardDescription>
                Detects understaffing based on ACTUAL assigned positions in the daily schedule
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => refetchUnderstaffed()}
                disabled={understaffedLoading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${understaffedLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button
                variant="outline"
                onClick={handleCreateAllAlerts}
                disabled={createAlertMutation.isPending || !understaffedShifts?.length}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create All Alerts
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-6">
            <Label htmlFor="shift-select" className="text-sm font-medium mb-2 block">
              Select Shift to Scan
            </Label>
            <Select value={selectedShiftId} onValueChange={setSelectedShiftId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a shift to scan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Shifts</SelectItem>
                {shiftTypes?.map((shift) => (
                  <SelectItem key={shift.id} value={shift.id}>
                    {shift.name} ({shift.start_time} - {shift.end_time})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {understaffedLoading ? (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">Scanning for understaffed shifts...</p>
            </div>
          ) : !understaffedShifts || understaffedShifts.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">
                No understaffed shifts found in the next 7 days.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Check browser console for detailed scan results.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {understaffedShifts.map((shift, index) => {
  console.log("🔄 RENDERING SHIFT - ACTUAL DATA:", {
    rawDate: shift.date,
    formattedDate: format(new Date(shift.date + 'T12:00:00'), "EEEE, MMM d, yyyy"),
    shiftName: shift.shift_types?.name,
    supervisors: shift.current_supervisors,
    officers: shift.current_officers
  });
  
  const alertExists = isAlertCreated(shift);
  
  const shiftName = shift.shift_types?.name || `Shift ID: ${shift.shift_type_id}`;
  const shiftTime = shift.shift_types 
    ? `${shift.shift_types.start_time} - ${shift.shift_types.end_time}`
    : "Time not available";

  return (
    <div
      key={`${shift.date}-${shift.shift_type_id}-${index}`}
      className="p-4 border rounded-lg space-y-3"
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="font-medium">{shiftName}</p>
          <p className="text-sm text-muted-foreground">
            {format(new Date(shift.date + 'T12:00:00'), "EEEE, MMM d, yyyy")} • {shiftTime}
          </p>
          
          <div className="bg-gray-100 p-2 rounded text-xs mt-2">
            <p className="text-gray-600">
              <strong>Staffing:</strong> {shift.current_staffing}/{shift.minimum_required} |
              <strong> Supervisors:</strong> {shift.current_supervisors}/{shift.min_supervisors} |
              <strong> Officers:</strong> {shift.current_officers}/{shift.min_officers}
            </p>
            <p className="text-gray-500 mt-1">
              <strong>Assigned:</strong> {shift.assigned_officers?.map(o => 
                `${o.name} (${o.position || 'No position'} - ${o.isSupervisor ? 'Supervisor' : 'Officer'})`
              ).join(', ') || 'None'}
            </p>
          </div>

          <div className="flex items-center gap-2 mt-2">
            <Badge variant="destructive">
              Total: {shift.current_staffing}/{shift.minimum_required}
            </Badge>
            {shift.isSupervisorsUnderstaffed && (
              <Badge variant="destructive">
                Needs {shift.min_supervisors - shift.current_supervisors} supervisor(s)
              </Badge>
            )}
            {shift.isOfficersUnderstaffed && (
              <Badge variant="destructive">
                Needs {shift.min_officers - shift.current_officers} officer(s)
              </Badge>
            )}
            {alertExists && (
              <Badge variant="outline" className="bg-green-500/10 text-green-700">
                Alert Created
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {!alertExists ? (
            <Button
              size="sm"
              onClick={() => handleCreateAlertFromDetection(shift)}
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
  onClick={handleCreateManualAlert}
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
          {alertsLoading ? (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">Loading alerts...</p>
            </div>
          ) : !alerts || alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No vacancy alerts created yet.</p>
          ) : (
            <div className="space-y-4">
              {alerts.map((alert) => {
                const shiftName = alert.shift_types?.name || `Shift ID: ${alert.shift_type_id}`;
                const shiftTime = alert.shift_types 
                  ? `${alert.shift_types.start_time} - ${alert.shift_types.end_time}`
                  : "Time not available";

                return (
                  <div key={alert.id} className="p-4 border rounded-lg space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="font-medium">{shiftName}</p>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(alert.date), "EEEE, MMM d, yyyy")} • {shiftTime}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Staffing: {alert.current_staffing} / {alert.minimum_required}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2 ml-4">
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
                );
              })}
            </div>
          )}
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
