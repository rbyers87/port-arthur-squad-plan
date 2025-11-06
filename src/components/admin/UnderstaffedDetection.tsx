// components/admin/UnderstaffedDetection.tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Mail, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { PREDEFINED_POSITIONS, RANK_ORDER } from "@/constants/positions";

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
        const allUnderstaffedShifts = [];
        const today = new Date();
        console.log(`🔍 Scanning 7 days starting from ${format(today, "yyyy-MM-dd")}`);

        // Check each date in the next 7 days
        for (let i = 0; i < 7; i++) {
          const date = new Date();
          date.setDate(date.getDate() + i);
          const dateStr = format(date, "yyyy-MM-dd");
          const dayOfWeek = date.getDay();

          console.log(`\n📅 Processing day ${i + 1}/7: ${dateStr} (${format(date, "EEEE")})`);

          try {
            // Get minimum staffing requirements for this day of week
            const { data: minimumStaffing, error: minError } = await supabase
              .from("minimum_staffing")
              .select("minimum_officers, minimum_supervisors, shift_type_id")
              .eq("day_of_week", dayOfWeek);
            
            if (minError) {
              console.error(`❌ Error getting minimum staffing for ${dateStr}:`, minError);
              continue; // Skip this day but continue with others
            }

            console.log("📊 Minimum staffing requirements:", minimumStaffing);

            // Use the updated approach to get staffing data
            const scheduleData = await getScheduleDataForUnderstaffing(date, selectedShiftId);
            
            if (!scheduleData || scheduleData.length === 0) {
              console.log("❌ No schedule data found for", dateStr);
              continue;
            }

            console.log(`📋 Schedule data for ${dateStr}:`, scheduleData.length, "shifts");

            // Check each shift for understaffing
            for (const shiftData of scheduleData) {
              const shift = shiftData.shift;
              
              // Filter by selected shift if needed
              if (selectedShiftId !== "all" && shift.id !== selectedShiftId) {
                continue;
              }

              const minStaff = minimumStaffing?.find(m => m.shift_type_id === shift.id);
              const minSupervisors = minStaff?.minimum_supervisors || 1;
              const minOfficers = minStaff?.minimum_officers || 2;

              console.log(`\n🔍 Checking shift: ${shift.name} (${shift.start_time} - ${shift.end_time})`);
              console.log(`📋 Min requirements: ${minSupervisors} supervisors, ${minOfficers} officers`);
              console.log(`👥 Current staffing: ${shiftData.currentSupervisors} supervisors, ${shiftData.currentOfficers} officers`);

              const supervisorsUnderstaffed = shiftData.currentSupervisors < minSupervisors;
              const officersUnderstaffed = shiftData.currentOfficers < minOfficers;
              const isUnderstaffed = supervisorsUnderstaffed || officersUnderstaffed;

              if (isUnderstaffed) {
                console.log("🚨 UNDERSTAFFED SHIFT FOUND:", {
                  date: dateStr,
                  shift: shift.name,
                  supervisors: `${shiftData.currentSupervisors}/${minSupervisors}`,
                  officers: `${shiftData.currentOfficers}/${minOfficers}`,
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
                  current_staffing: shiftData.currentSupervisors + shiftData.currentOfficers,
                  minimum_required: minSupervisors + minOfficers,
                  current_supervisors: shiftData.currentSupervisors,
                  current_officers: shiftData.currentOfficers,
                  min_supervisors: minSupervisors,
                  min_officers: minOfficers,
                  day_of_week: dayOfWeek,
                  isSupervisorsUnderstaffed: supervisorsUnderstaffed,
                  isOfficersUnderstaffed: officersUnderstaffed,
                  assigned_officers: [
                    ...shiftData.supervisors.map(s => s.name),
                    ...shiftData.officers.map(o => o.name)
                  ]
                };

                console.log("📊 Storing understaffed shift data:", shiftAlertData);
                allUnderstaffedShifts.push(shiftAlertData);
              } else {
                console.log("✅ Shift is properly staffed");
              }
            }
          } catch (dayError) {
            console.error(`❌ Error processing date ${dateStr}:`, dayError);
            // Continue with next day instead of failing entirely
            continue;
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

// Updated function to get staffing data using the same logic as DailyScheduleView
async function getScheduleDataForUnderstaffing(selectedDate: Date, filterShiftId: string = "all") {
  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const dayOfWeek = selectedDate.getDay();

  console.log("🔄 getScheduleDataForUnderstaffing called for:", { dateStr, filterShiftId });

  // Function to sort supervisors by rank
  const sortSupervisorsByRank = (supervisors: any[]) => {
    return supervisors.sort((a, b) => {
      const rankA = a.rank || 'Officer';
      const rankB = b.rank || 'Officer';
      return (RANK_ORDER[rankA as keyof typeof RANK_ORDER] || 99) - (RANK_ORDER[rankB as keyof typeof RANK_ORDER] || 99);
    });
  };

  // Get all shift types
  const { data: shiftTypes, error: shiftError } = await supabase
    .from("shift_types")
    .select("*")
    .order("start_time");
  if (shiftError) throw shiftError;

  // Get minimum staffing requirements
  const { data: minimumStaffing, error: minError } = await supabase
    .from("minimum_staffing")
    .select("minimum_officers, minimum_supervisors, shift_type_id")
    .eq("day_of_week", dayOfWeek);
  if (minError) throw minError;

  // Get default assignments for all officers for this date
  const { data: allDefaultAssignments, error: defaultAssignmentsError } = await supabase
    .from("officer_default_assignments")
    .select("*")
    .or(`end_date.is.null,end_date.gte.${dateStr}`)
    .lte("start_date", dateStr);

  if (defaultAssignmentsError) {
    console.error("Default assignments error:", defaultAssignmentsError);
  }

  // Helper function to get default assignment for an officer
  const getDefaultAssignment = (officerId: string) => {
    if (!allDefaultAssignments) return null;
    
    const currentDate = parseISO(dateStr);
    
    return allDefaultAssignments.find(da => 
      da.officer_id === officerId &&
      parseISO(da.start_date) <= currentDate &&
      (!da.end_date || parseISO(da.end_date) >= currentDate)
    );
  };

  // FIXED: Use explicit relationship name to avoid ambiguity
  const { data: recurringData, error: recurringError } = await supabase
    .from("recurring_schedules")
    .select(`
      *,
      profiles:officer_id (
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
    .or(`end_date.is.null,end_date.gte.${dateStr}`);

  if (recurringError) {
    console.error("Recurring schedules error:", recurringError);
    throw recurringError;
  }

  // Get schedule exceptions for this specific date
  const { data: exceptionsData, error: exceptionsError } = await supabase
    .from("schedule_exceptions")
    .select("*")
    .eq("date", dateStr);

  if (exceptionsError) {
    console.error("Schedule exceptions error:", exceptionsError);
    throw exceptionsError;
  }

  // Get officer profiles separately
  const officerIds = [...new Set(exceptionsData?.map(e => e.officer_id).filter(Boolean))];
  let officerProfiles = [];

  if (officerIds.length > 0) {
    const { data: profilesData, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, badge_number, rank")
      .in("id", officerIds);
    
    if (profilesError) {
      console.error("❌ Profiles error:", profilesError);
    } else {
      officerProfiles = profilesData || [];
    }
  }

  // Get shift types for exceptions separately
  const shiftTypeIds = [...new Set(exceptionsData?.map(e => e.shift_type_id).filter(Boolean))];
  let exceptionShiftTypes = [];

  if (shiftTypeIds.length > 0) {
    const { data: shiftTypesData, error: shiftTypesError } = await supabase
      .from("shift_types")
      .select("id, name, start_time, end_time")
      .in("id", shiftTypeIds);
    
    if (shiftTypesError) {
      console.error("❌ Shift types error:", shiftTypesError);
    } else {
      exceptionShiftTypes = shiftTypesData || [];
    }
  }

  // Combine the data manually
  const combinedExceptions = exceptionsData?.map(exception => ({
    ...exception,
    profiles: officerProfiles.find(p => p.id === exception.officer_id),
    shift_types: exceptionShiftTypes.find(s => s.id === exception.shift_type_id)
  })) || [];

  // Separate PTO exceptions from regular exceptions
  const ptoExceptions = combinedExceptions?.filter(e => e.is_off) || [];
  const workingExceptions = combinedExceptions?.filter(e => !e.is_off) || [];

  console.log("📊 DEBUG: Data counts", {
    recurring: recurringData?.length,
    workingExceptions: workingExceptions.length,
    ptoExceptions: ptoExceptions.length,
    defaultAssignments: allDefaultAssignments?.length
  });

  // Build schedule by shift
  const scheduleByShift = shiftTypes?.map((shift) => {
    const minStaff = minimumStaffing?.find(m => m.shift_type_id === shift.id);

    // Get ALL officers for this shift, avoiding duplicates
    const allOfficersMap = new Map();

    // Process recurring officers for this shift
    recurringData
      ?.filter(r => r.shift_types?.id === shift.id)
      .forEach(r => {
        const officerKey = `${r.officer_id}-${shift.id}`;
        
        const workingException = workingExceptions?.find(e => 
          e.officer_id === r.officer_id && e.shift_type_id === shift.id
        );

        const ptoException = ptoExceptions?.find(e => 
          e.officer_id === r.officer_id && e.shift_type_id === shift.id
        );

        const defaultAssignment = getDefaultAssignment(r.officer_id);

        const officerRank = workingException?.profiles?.rank || r.profiles?.rank;
        const isProbationary = officerRank?.toLowerCase().includes('probationary');

        let customTime = undefined;
        if (ptoException?.custom_start_time && ptoException?.custom_end_time) {
          const shiftStart = shift.start_time;
          const shiftEnd = shift.end_time;
          const ptoStart = ptoException.custom_start_time;
          const ptoEnd = ptoException.custom_end_time;
          
          if (ptoStart === shiftStart && ptoEnd !== shiftEnd) {
            customTime = `Working: ${ptoEnd} - ${shiftEnd}`;
          } else if (ptoStart !== shiftStart && ptoEnd === shiftEnd) {
            customTime = `Working: ${shiftStart} - ${ptoStart}`;
          } else if (ptoStart !== shiftStart && ptoEnd !== shiftEnd) {
            customTime = `Working: ${shiftStart}-${ptoStart} & ${ptoEnd}-${shiftEnd}`;
          } else {
            customTime = `Working: Check PTO`;
          }
        } else if (workingException?.custom_start_time && workingException?.custom_end_time) {
          customTime = `${workingException.custom_start_time} - ${workingException.custom_end_time}`;
        }

        const finalData = workingException ? {
          scheduleId: workingException.id,
          officerId: r.officer_id,
          name: workingException.profiles?.full_name || r.profiles?.full_name || "Unknown",
          badge: workingException.profiles?.badge_number || r.profiles?.badge_number,
          rank: officerRank,
          isPPO: isProbationary,
          position: workingException.position_name || r.position_name || defaultAssignment?.position_name,
          unitNumber: workingException.unit_number || r.unit_number || defaultAssignment?.unit_number,
          notes: workingException.notes,
          type: "recurring" as const,
          originalScheduleId: r.id,
          customTime: customTime,
          hasPTO: !!ptoException,
          ptoData: ptoException ? {
            id: ptoException.id,
            ptoType: ptoException.reason,
            startTime: ptoException.custom_start_time || shift.start_time,
            endTime: ptoException.custom_end_time || shift.end_time,
            isFullShift: !ptoException.custom_start_time && !ptoException.custom_end_time
          } : undefined,
          isPartnership: workingException.is_partnership || r.is_partnership,
          partnerOfficerId: workingException.partner_officer_id || r.partner_officer_id,
          shift: shift,
          isExtraShift: false
        } : {
          scheduleId: r.id,
          officerId: r.officer_id,
          name: r.profiles?.full_name || "Unknown",
          badge: r.profiles?.badge_number,
          rank: officerRank,
          isPPO: isProbationary,
          position: r.position_name || defaultAssignment?.position_name,
          unitNumber: r.unit_number || defaultAssignment?.unit_number,
          notes: null,
          type: "recurring" as const,
          originalScheduleId: r.id,
          customTime: customTime,
          hasPTO: !!ptoException,
          ptoData: ptoException ? {
            id: ptoException.id,
            ptoType: ptoException.reason,
            startTime: ptoException.custom_start_time || shift.start_time,
            endTime: ptoException.custom_end_time || shift.end_time,
            isFullShift: !ptoException.custom_start_time && !ptoException.custom_end_time
          } : undefined,
          isPartnership: r.is_partnership,
          partnerOfficerId: r.partner_officer_id,
          shift: shift,
          isExtraShift: false
        };

        allOfficersMap.set(officerKey, finalData);
      });

    // Process additional officers from working exceptions
    workingExceptions
      ?.filter(e => e.shift_type_id === shift.id)
      .forEach(e => {
        const officerKey = `${e.officer_id}-${shift.id}`;
        
        if (allOfficersMap.has(officerKey)) {
          console.log("🔄 Skipping duplicate officer (already in recurring):", e.profiles?.full_name);
          return;
        }

        const isRegularRecurring = recurringData?.some(r => 
          r.officer_id === e.officer_id && 
          r.shift_types?.id === shift.id &&
          r.day_of_week === dayOfWeek
        );

        const ptoException = ptoExceptions?.find(p => 
          p.officer_id === e.officer_id && p.shift_type_id === shift.id
        );

        const officerRank = e.profiles?.rank;
        const isProbationary = officerRank?.toLowerCase().includes('probationary');

        const defaultAssignment = getDefaultAssignment(e.officer_id);

        let customTime = undefined;
        if (ptoException?.custom_start_time && ptoException?.custom_end_time) {
          const shiftStart = shift.start_time;
          const shiftEnd = shift.end_time;
          const ptoStart = ptoException.custom_start_time;
          const ptoEnd = ptoException.custom_end_time;
          
          if (ptoStart === shiftStart && ptoEnd !== shiftEnd) {
            customTime = `Working: ${ptoEnd} - ${shiftEnd}`;
          } else if (ptoStart !== shiftStart && ptoEnd === shiftEnd) {
            customTime = `Working: ${shiftStart} - ${ptoStart}`;
          } else if (ptoStart !== shiftStart && ptoEnd !== shiftEnd) {
            customTime = `Working: ${shiftStart}-${ptoStart} & ${ptoEnd}-${shiftEnd}`;
          } else {
            customTime = `Working: Check PTO`;
          }
        } else if (e.custom_start_time && e.custom_end_time) {
          customTime = `${e.custom_start_time} - ${e.custom_end_time}`;
        }

        const officerData = {
          scheduleId: e.id,
          officerId: e.officer_id,
          name: e.profiles?.full_name || "Unknown",
          badge: e.profiles?.badge_number,
          rank: officerRank,
          isPPO: isProbationary,
          position: e.position_name || defaultAssignment?.position_name,
          unitNumber: e.unit_number || defaultAssignment?.unit_number,
          notes: e.notes,
          type: isRegularRecurring ? "recurring" : "exception" as const,
          originalScheduleId: null,
          customTime: customTime,
          hasPTO: !!ptoException,
          ptoData: ptoException ? {
            id: ptoException.id,
            ptoType: ptoException.reason,
            startTime: ptoException.custom_start_time || shift.start_time,
            endTime: ptoException.custom_end_time || shift.end_time,
            isFullShift: !ptoException.custom_start_time && !ptoException.custom_end_time
          } : undefined,
          isPartnership: e.is_partnership,
          partnerOfficerId: e.partner_officer_id,
          shift: shift,
          isExtraShift: !isRegularRecurring
        };

        allOfficersMap.set(officerKey, officerData);
      });

    const allOfficers = Array.from(allOfficersMap.values());

    // Process partnerships
    const processedOfficers = [];
    const processedOfficerIds = new Set();
    const partnershipMap = new Map();

    for (const officer of allOfficers) {
      if (officer.isPartnership && officer.partnerOfficerId) {
        const partnerOfficer = allOfficers.find(o => o.officerId === officer.partnerOfficerId);
        if (partnerOfficer && partnerOfficer.isPartnership && partnerOfficer.partnerOfficerId === officer.officerId) {
          partnershipMap.set(officer.officerId, officer.partnerOfficerId);
          partnershipMap.set(officer.partnerOfficerId, officer.officerId);
        } else {
          officer.isPartnership = false;
          officer.partnerOfficerId = null;
        }
      }
    }

    for (const officer of allOfficers) {
      if (processedOfficerIds.has(officer.officerId)) {
        continue;
      }

      const partnerOfficerId = partnershipMap.get(officer.officerId);
      
      if (partnerOfficerId && partnershipMap.get(partnerOfficerId) === officer.officerId) {
        const partnerOfficer = allOfficers.find(o => o.officerId === partnerOfficerId);
        
        if (partnerOfficer) {
          let primaryOfficer = officer;
          let secondaryOfficer = partnerOfficer;
          
          if (officer.isPPO && !partnerOfficer.isPPO) {
            primaryOfficer = partnerOfficer;
            secondaryOfficer = officer;
          } else if (officer.isPPO === partnerOfficer.isPPO) {
            primaryOfficer = officer.name.localeCompare(partnerOfficer.name) < 0 ? officer : partnerOfficer;
            secondaryOfficer = officer.name.localeCompare(partnerOfficer.name) < 0 ? partnerOfficer : officer;
          }

          const combinedOfficer = {
            ...primaryOfficer,
            isCombinedPartnership: true,
            partnerData: {
              partnerOfficerId: secondaryOfficer.officerId,
              partnerName: secondaryOfficer.name,
              partnerBadge: secondaryOfficer.badge,
              partnerRank: secondaryOfficer.rank,
              partnerIsPPO: secondaryOfficer.isPPO,
              partnerPosition: secondaryOfficer.position,
              partnerUnitNumber: secondaryOfficer.unitNumber,
              partnerScheduleId: secondaryOfficer.scheduleId,
              partnerType: secondaryOfficer.type
            },
            partnerOfficerId: secondaryOfficer.officerId,
            originalPartnerOfficerId: secondaryOfficer.officerId,
            position: primaryOfficer.position || secondaryOfficer.position,
            unitNumber: primaryOfficer.unitNumber || secondaryOfficer.unitNumber,
            notes: primaryOfficer.notes || secondaryOfficer.notes ? 
              `${primaryOfficer.notes || ''}${primaryOfficer.notes && secondaryOfficer.notes ? ' / ' : ''}${secondaryOfficer.notes || ''}`.trim() 
              : null,
            isPartnership: true
          };

          processedOfficers.push(combinedOfficer);
          processedOfficerIds.add(primaryOfficer.officerId);
          processedOfficerIds.add(secondaryOfficer.officerId);
        } else {
          processedOfficers.push(officer);
          processedOfficerIds.add(officer.officerId);
        }
      } else {
        processedOfficers.push(officer);
        processedOfficerIds.add(officer.officerId);
      }
    }

    // Get PTO records for this shift
    const shiftPTORecords = ptoExceptions?.filter(e => 
      e.shift_type_id === shift.id
    ).map(e => ({
      id: e.id,
      officerId: e.officer_id,
      name: e.profiles?.full_name || "Unknown",
      badge: e.profiles?.badge_number,
      rank: e.profiles?.rank,
      ptoType: e.reason || "PTO",
      startTime: e.custom_start_time || shift.start_time,
      endTime: e.custom_end_time || shift.end_time,
      isFullShift: !e.custom_start_time && !e.custom_end_time,
      notes: e.notes,
      customTime: e.custom_start_time && e.custom_end_time ? 
        `${e.custom_start_time} - ${e.custom_end_time}` : undefined
    })) || [];

    // Categorize officers - UPDATED to match DailyScheduleView logic
    const supervisors = sortSupervisorsByRank(
      processedOfficers.filter(o => 
        o.position?.toLowerCase().includes('supervisor')
      )
    );

    const specialAssignmentOfficers = processedOfficers.filter(o => {
      const position = o.position?.toLowerCase() || '';
      return position.includes('other') || 
             (o.position && !PREDEFINED_POSITIONS.includes(o.position));
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const regularOfficers = processedOfficers.filter(o => 
      !o.position?.toLowerCase().includes('supervisor') && 
      !specialAssignmentOfficers.includes(o)
    ).sort((a, b) => {
      const aMatch = a.position?.match(/district\s*(\d+)/i);
      const bMatch = b.position?.match(/district\s*(\d+)/i);
      
      if (aMatch && bMatch) {
        return parseInt(aMatch[1]) - parseInt(bMatch[1]);
      }
      
      return (a.position || '').localeCompare(b.position || '');
    });

    // Calculate staffing counts - UPDATED to match DailyScheduleView logic
    const countedSupervisors = supervisors.filter(supervisor => {
      const hasFullDayPTO = supervisor.hasPTO && supervisor.ptoData?.isFullShift;
      return !hasFullDayPTO;
    });

    const countedOfficers = regularOfficers.filter(officer => {
      const isPPO = officer.isPPO;
      const hasFullDayPTO = officer.hasPTO && officer.ptoData?.isFullShift;
      return !isPPO && !hasFullDayPTO;
    });

    console.log(`📊 Staffing counts for ${shift.name}:`, {
      totalSupervisors: supervisors.length,
      countedSupervisors: countedSupervisors.length,
      totalOfficers: regularOfficers.length,
      countedOfficers: countedOfficers.length,
      ppos: regularOfficers.filter(o => o.isPPO).length,
      fullDayPTOs: processedOfficers.filter(o => o.hasPTO && o.ptoData?.isFullShift).length,
      partnerships: processedOfficers.filter(o => o.isCombinedPartnership).length
    });

    return {
      shift,
      minSupervisors: minStaff?.minimum_supervisors || 1,
      minOfficers: minStaff?.minimum_officers || 0,
      currentSupervisors: countedSupervisors.length,
      currentOfficers: countedOfficers.length,
      supervisors,
      officers: regularOfficers,
      specialAssignmentOfficers,
      ptoRecords: shiftPTORecords,
    };
  }) || [];

  // Filter by shift if needed
  const filteredSchedule = filterShiftId === "all" 
    ? scheduleByShift 
    : scheduleByShift.filter(s => s.shift.id === filterShiftId);

  console.log("✅ getScheduleDataForUnderstaffing completed:", {
    totalShifts: scheduleByShift.length,
    filteredShifts: filteredSchedule.length,
    selectedShiftId: filterShiftId
  });

  return filteredSchedule;
}
