// components/admin/UnderstaffedDetection.tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Mail, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useState } from "react";

export const UnderstaffedDetection = () => {
  const queryClient = useQueryClient();
  const [selectedShiftId, setSelectedShiftId] = useState<string>("all");

  // Get all shift types for the dropdown
  const { data: shiftTypes } = useQuery({
    queryKey: ["shift-types-for-detection"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_types")
        .select("*")
        .order("start_time");
      if (error) throw error;
      return data;
    },
  });

  const { 
    data: understaffedShifts, 
    isLoading, 
    error,
    refetch
  } = useQuery({
    queryKey: ["understaffed-shifts-detection", selectedShiftId],
    queryFn: async () => {
      console.log("🔍 Starting understaffed shift detection...");
      
      try {
        // Use the working dashboard stats approach - fetch data directly without joins
        const allUnderstaffedShifts = [];

        // Check each date in the next 7 days
        for (let i = 0; i < 7; i++) {
          const date = new Date();
          date.setDate(date.getDate() + i);
          const dateStr = format(date, "yyyy-MM-dd");
          const dayOfWeek = date.getDay();

          console.log(`\n📋 Checking date: ${dateStr}, dayOfWeek: ${dayOfWeek}`);

          // Get minimum staffing requirements for this day of week
          const { data: minimumStaffing, error: minError } = await supabase
            .from("minimum_staffing")
            .select("minimum_officers, minimum_supervisors, shift_type_id")
            .eq("day_of_week", dayOfWeek);
          
          if (minError) throw minError;

          console.log("📊 Minimum staffing requirements:", minimumStaffing);

          // Use the dashboard stats approach - fetch staffing data directly
          const staffingData = await getStaffingDataForDate(dateStr, dayOfWeek);
          
          if (!staffingData) {
            console.log("❌ No staffing data found for", dateStr);
            continue;
          }

          console.log(`📋 Staffing data for ${dateStr}:`, staffingData);

          // Check each shift for understaffing
          for (const shiftName in staffingData) {
            const shiftData = staffingData[shiftName];
            const shift = shiftTypes?.find(s => s.name === shiftName);
            
            if (!shift) {
              console.log(`❌ Shift not found: ${shiftName}`);
              continue;
            }

            // Filter by selected shift if needed
            if (selectedShiftId !== "all" && shift.id !== selectedShiftId) {
              continue;
            }

            const minStaff = minimumStaffing?.find(m => m.shift_type_id === shift.id);
            const minSupervisors = minStaff?.minimum_supervisors || 1;
            const minOfficers = minStaff?.minimum_officers || 2;

            console.log(`\n🔍 Checking shift: ${shift.name} (${shift.start_time} - ${shift.end_time})`);
            console.log(`📋 Min requirements: ${minSupervisors} supervisors, ${minOfficers} officers`);
            console.log(`👥 Current staffing: ${shiftData.supervisors} supervisors, ${shiftData.officers} officers`);

            const supervisorsUnderstaffed = shiftData.supervisors < minSupervisors;
            const officersUnderstaffed = shiftData.officers < minOfficers;
            const isUnderstaffed = supervisorsUnderstaffed || officersUnderstaffed;

            if (isUnderstaffed) {
              console.log("🚨 UNDERSTAFFED SHIFT FOUND:", {
                date: dateStr,
                shift: shift.name,
                supervisors: `${shiftData.supervisors}/${minSupervisors}`,
                officers: `${shiftData.officers}/${minOfficers}`,
                dayOfWeek
              });

              const shiftAlertData = {
                date: dateStr,
                shift_type_id: shift.id,
                shift_types: {
                  id: shift.id,
                  name: shift.name,
                  start_time: shift.start_time,
                  end_time: shift.end_time
                },
                current_staffing: shiftData.supervisors + shiftData.officers,
                minimum_required: minSupervisors + minOfficers,
                current_supervisors: shiftData.supervisors,
                current_officers: shiftData.officers,
                min_supervisors: minSupervisors,
                min_officers: minOfficers,
                day_of_week: dayOfWeek,
                isSupervisorsUnderstaffed: supervisorsUnderstaffed,
                isOfficersUnderstaffed: officersUnderstaffed,
                assigned_officers: [] // We can't get individual officers without the problematic query
              };

              console.log("📊 Storing understaffed shift data:", shiftAlertData);
              allUnderstaffedShifts.push(shiftAlertData);
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

  // ... rest of the component remains the same
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
      console.log("🔍 Creating alert for:", {
        shift_type_id: shiftData.shift_type_id,
        shift_name: shiftData.shift_types?.name,
        date: shiftData.date
      });

      // Check if alert already exists
      const existingAlert = existingAlerts?.find(alert => 
        alert.date === shiftData.date && 
        alert.shift_type_id === shiftData.shift_type_id
      );

      if (existingAlert) {
        console.log("⚠️ Alert already exists");
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
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success("Vacancy alert created");
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

      // FIXED: Cast to any[] to avoid TypeScript errors
      const officersArray = officers as any[];

      // Send email notifications to all officers
      const emailPromises = officersArray?.map(async (officer) => {
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
      const textPromises = officersArray
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
      
      console.log("✅ Alerts sent successfully");

    },
    onSuccess: () => {
      toast.success("Alerts sent successfully to all officers");
      queryClient.invalidateQueries({ queryKey: ["existing-vacancy-alerts"] });
    },
    onError: (error) => {
      toast.error("Failed to send alerts: " + error.message);
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      await refetch();
    },
    onSuccess: () => {
      toast.success("Rescanned for understaffed shifts");
    },
    onError: (error) => {
      toast.error("Failed to refresh: " + error.message);
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

  const handleRefresh = () => {
    refreshMutation.mutate();
  };

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-red-600">
            Error loading understaffed shifts: {error.message}
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
              Detects understaffing based on actual assigned positions in the daily schedule
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={refreshMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
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

        {!understaffedShifts || understaffedShifts.length === 0 ? (
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
                        {format(new Date(shift.date), "EEEE, MMM d, yyyy")} • {shiftTime}
                      </p>
                      
                      <div className="bg-gray-100 p-2 rounded text-xs mt-2">
                        <p className="text-gray-600">
                          <strong>Staffing:</strong> {shift.current_staffing}/{shift.minimum_required} |
                          <strong> Supervisors:</strong> {shift.current_supervisors}/{shift.min_supervisors} |
                          <strong> Officers:</strong> {shift.current_officers}/{shift.min_officers}
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
};

// Simple function to get staffing data without problematic joins
async function getStaffingDataForDate(dateStr: string, dayOfWeek: number) {
  try {
    // Use the dashboard stats approach - call the existing function that works
    const { getScheduleData } = await import("@/components/schedule/DailyScheduleView");
    const scheduleData = await getScheduleData(new Date(dateStr), "all");
    
    if (!scheduleData) return null;

    // Extract staffing counts from the working schedule data
    const staffingData: Record<string, { supervisors: number; officers: number }> = {};
    
    for (const shiftData of scheduleData) {
      staffingData[shiftData.shift.name] = {
        supervisors: shiftData.currentSupervisors,
        officers: shiftData.currentOfficers
      };
    }

    return staffingData;
  } catch (error) {
    console.error("Error getting staffing data:", error);
    return null;
  }
}
