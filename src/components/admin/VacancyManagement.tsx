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
import { Calendar as CalendarIcon, Plus, Users, RefreshCw, AlertTriangle, Mail, Check, X, Clock } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useCreateVacancyAlert } from "@/hooks/useCreateVacancyAlert";

interface VacancyManagementProps {
  isOfficerView?: boolean;
  userId?: string;
}

export const VacancyManagement = ({ isOfficerView = false, userId }: VacancyManagementProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedShift, setSelectedShift] = useState<string>();
  const [minimumRequired, setMinimumRequired] = useState<string>("2");
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [selectedShiftId, setSelectedShiftId] = useState<string>("all");
  const queryClient = useQueryClient();
  const [customMessage, setCustomMessage] = useState("");
  const [showCustomMessageDialog, setShowCustomMessageDialog] = useState(false);
  const [selectedShiftForCustomMessage, setSelectedShiftForCustomMessage] = useState<any>(null);
  const [detectionCustomMessage, setDetectionCustomMessage] = useState("");

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

  // FIXED: Updated responses query to handle multiple relationships
  const { data: responses, refetch: refetchResponses } = useQuery({
    queryKey: ["vacancy-responses-admin"],
    queryFn: async () => {
      console.log("🔄 Fetching officer responses...");
      
      // Use separate queries to avoid relationship conflicts
      const { data: responsesData, error: responsesError } = await supabase
        .from("vacancy_responses")
        .select(`
          id,
          created_at,
          status,
          officer_id,
          alert_id,
          vacancy_alert_id,
          approved_by,
          approved_at,
          rejection_reason,
          profiles!vacancy_responses_officer_id_fkey(
            full_name,
            badge_number
          )
        `)
        .order("created_at", { ascending: false });

      if (responsesError) {
        console.error("Error fetching responses:", responsesError);
        throw responsesError;
      }

      if (!responsesData || responsesData.length === 0) {
        return [];
      }

      // Get alert IDs (use whichever column has data)
      const alertIds = responsesData
        .map(r => r.alert_id || r.vacancy_alert_id)
        .filter(Boolean);

      if (alertIds.length === 0) {
        console.log("No alert IDs found in responses");
        return responsesData.map(response => ({
          ...response,
          vacancy_alerts: null
        }));
      }

      // Fetch alert details separately to avoid relationship conflicts
      const { data: alertsData, error: alertsError } = await supabase
        .from("vacancy_alerts")
        .select(`
          id,
          date,
          shift_type_id,
          shift_types(
            name
          )
        `)
        .in("id", alertIds);

      if (alertsError) {
        console.error("Error fetching alerts:", alertsError);
        // Return responses without alert data if there's an error
        return responsesData.map(response => ({
          ...response,
          vacancy_alerts: null
        }));
      }

      // Combine data
      const combinedData = responsesData.map(response => {
        const alertId = response.alert_id || response.vacancy_alert_id;
        const alert = alertsData?.find(a => a.id === alertId);
        
        return {
          ...response,
          vacancy_alerts: alert
        };
      });

      console.log("📋 Final officer responses:", combinedData);
      return combinedData;
    },
  });

  // Function to add officer to shift as an extra assignment - MATCHES SCHEDULER EXACTLY
  const addOfficerToShift = async (responseId: string) => {
    try {
      // Get the response details with alert information - use separate queries to avoid relationship conflicts
      const { data: response, error: responseError } = await supabase
        .from("vacancy_responses")
        .select(`
          *,
          profiles!vacancy_responses_officer_id_fkey(
            full_name,
            badge_number
          )
        `)
        .eq("id", responseId)
        .single();

      if (responseError) {
        console.error("Error fetching response details:", responseError);
        throw responseError;
      }

      if (!response) {
        console.error("No response data found");
        return;
      }

      // Get alert details separately
      const alertId = response.alert_id || response.vacancy_alert_id;
      if (!alertId) {
        console.error("No alert ID found in response");
        return;
      }

      const { data: alertData, error: alertError } = await supabase
        .from("vacancy_alerts")
        .select(`
          date,
          shift_type_id,
          shift_types(
            name,
            start_time,
            end_time
          )
        `)
        .eq("id", alertId)
        .single();

      if (alertError) {
        console.error("Error fetching alert details:", alertError);
        throw alertError;
      }

      const officer = response.profiles;

      console.log("Adding officer to shift as extra assignment:", {
        officer: officer?.full_name,
        officerId: response.officer_id,
        shift: alertData.shift_types?.name,
        shiftTypeId: alertData.shift_type_id,
        date: alertData.date
      });

      // EXACTLY match your scheduler's "Add Officer" function
      const { error: exceptionError } = await supabase
        .from("schedule_exceptions")
        .insert({
          officer_id: response.officer_id,
          shift_type_id: alertData.shift_type_id,
          date: alertData.date,
          is_off: false, // Working shift (not PTO)
          position_name: "Extra Shift", // Same as your scheduler
          unit_number: null, // Can be set later by supervisor if needed
          notes: `Approved vacancy request - ID: ${responseId}`,
          created_by: userId,
          custom_start_time: null,
          custom_end_time: null
        });

      if (exceptionError) {
        console.error("Error creating schedule exception:", exceptionError);
        throw exceptionError;
      }

      console.log("Successfully added officer to shift as extra assignment");

      // Optional: Send a confirmation notification
      await sendShiftAssignmentNotification(response.officer_id, alertData);

    } catch (error) {
      console.error("Error in addOfficerToShift:", error);
      throw error;
    }
  };

  // Optional: Send notification about the shift assignment
  const sendShiftAssignmentNotification = async (officerId: string, alert: any) => {
    try {
      const shiftName = alert.shift_types?.name || "Unknown Shift";
      const date = alert.date ? format(new Date(alert.date), "EEEE, MMM d, yyyy") : "Unknown Date";
      
      const { error } = await supabase.rpc('create_vacancy_notification', {
        officer_id: officerId,
        notification_title: "Extra Shift Assignment Confirmed",
        notification_message: `You have been assigned to ${shiftName} on ${date} as an extra shift. This assignment was approved from your vacancy alert response.`,
        notification_type: 'shift_assignment'
      });

      if (error) {
        console.error("Error sending assignment notification:", error);
      }
    } catch (err) {
      console.error("Error in sendShiftAssignmentNotification:", err);
    }
  };

  // Send response notification to officer
  const sendResponseNotification = async (response: any, status: string, rejectionReason?: string) => {
    try {
      const officerId = response.officer_id;
      const alert = response.vacancy_alerts;
      const shiftName = alert?.shift_types?.name || "Unknown Shift";
      const date = alert?.date ? format(new Date(alert.date), "EEEE, MMM d, yyyy") : "Unknown Date";

      let title = "";
      let message = "";

      if (status === "approved") {
        title = "Vacancy Request Approved";
        message = `Your request for ${shiftName} on ${date} has been approved. You have been assigned to this shift.`;
      } else {
        title = "Vacancy Request Denied";
        message = `Your request for ${shiftName} on ${date} has been denied.`;
        if (rejectionReason) {
          message += ` Reason: ${rejectionReason}`;
        }
      }

      const { error } = await supabase.rpc('create_vacancy_notification', {
        officer_id: officerId,
        notification_title: title,
        notification_message: message,
        notification_type: 'vacancy_response'
      });

      if (error) {
        console.error("Error sending response notification:", error);
      }
    } catch (err) {
      console.error("Error in sendResponseNotification:", err);
    }
  };

  // Mutation for approving/denying responses - with automatic shift assignment
  const updateResponseMutation = useMutation({
    mutationFn: async ({ 
      responseId, 
      status, 
      rejectionReason 
    }: { 
      responseId: string; 
      status: string; 
      rejectionReason?: string;
    }) => {
      // Map UI status to database values
      const dbStatus = status === "approved" ? "accepted" : "rejected";

      const updateData: any = {
        status: dbStatus,
        approved_by: userId,
        approved_at: new Date().toISOString()
      };

      if (rejectionReason) {
        updateData.rejection_reason = rejectionReason;
      }

      console.log("Updating response with data:", updateData);

      const { error } = await supabase
        .from("vacancy_responses")
        .update(updateData)
        .eq("id", responseId);

      if (error) {
        console.error("Supabase update error:", error);
        throw error;
      }

      // If approved, create a schedule exception to add the officer to the shift
      if (status === "approved") {
        await addOfficerToShift(responseId);
      }

      // Send notification to officer (use our original status for user-friendly messaging)
      const response = responses?.find(r => r.id === responseId);
      if (response) {
        await sendResponseNotification(response, status, rejectionReason);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vacancy-responses-admin"] });
      queryClient.invalidateQueries({ queryKey: ["understaffed-shifts-detection"] });
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
      toast.success("Response updated successfully");
    },
    onError: (error) => {
      console.error("Update response error:", error);
      toast.error("Failed to update response: " + error.message);
    },
  });

  // Get status badge variant
  const getStatusVariant = (status: string) => {
    switch (status) {
      case "interested":
        return "outline";
      case "accepted":
        return "default";
      case "rejected":
        return "destructive";
      default:
        return "outline";
    }
  };

  // Get status display text
  const getStatusDisplay = (status: string) => {
    switch (status) {
      case "interested":
        return "Pending";
      case "accepted":
        return "Approved";
      case "rejected":
        return "Denied";
      default:
        return status;
    }
  };

  // Get status icon
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "interested":
        return <Clock className="h-3 w-3" />;
      case "accepted":
        return <Check className="h-3 w-3" />;
      case "rejected":
        return <X className="h-3 w-3" />;
      default:
        return <Clock className="h-3 w-3" />;
    }
  };

 // Understaffed Detection Query - COMPLETELY REWRITTEN to avoid relationship conflicts
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

        // Get ALL schedule data for this date - USING SEPARATE QUERIES TO AVOID RELATIONSHIP CONFLICTS
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

        // Get schedule exceptions for this specific date - SEPARATE QUERIES TO AVOID RELATIONSHIP CONFLICTS
        const { data: exceptionsData, error: exceptionsError } = await supabase
          .from("schedule_exceptions")
          .select("*")
          .eq("date", date);

        if (exceptionsError) {
          console.error("❌ Schedule exceptions error:", exceptionsError);
          throw exceptionsError;
        }

        // Get officer profiles separately to avoid relationship conflicts
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

        console.log(`📝 Total exceptions: ${combinedExceptions?.length || 0} (PTO: ${ptoExceptions.length}, Working: ${workingExceptions.length})`);

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
              e.shift_type_id === shift.id
            );

            // Check if this officer has PTO for today
            const ptoException = ptoExceptions?.find(e => 
              e.officer_id === recurringOfficer.officer_id && 
              e.shift_type_id === shift.id
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
              e.shift_type_id === shift.id &&
              !recurringData?.some(r => r.officer_id === e.officer_id)
            ) || [];

          for (const additionalOfficer of additionalOfficers) {
            // Check if this officer has PTO for today
            const ptoException = ptoExceptions?.find(p => 
              p.officer_id === additionalOfficer.officer_id && 
              p.shift_type_id === shift.id
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
      minimum_required: parseInt(minimumRequired),
      custom_message: customMessage // Add custom message
    }, {
      onSuccess: () => {
        setDialogOpen(false);
        setSelectedDate(undefined);
        setSelectedShift(undefined);
        setMinimumRequired("2");
        setCustomMessage(""); // Reset custom message
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
    console.log("Sending alerts for:", alertData);

    // Get all active officers with their notification preferences
    const { data: officers, error: officersError } = await supabase
      .from("profiles")
      .select("id, email, phone, notification_preferences, full_name")
      .eq('active', true);

    if (officersError) {
      console.error("Error fetching officers:", officersError);
      throw officersError;
    }

    console.log(`Found ${officers?.length || 0} active officers`);

    const emailPromises = [];
    const textPromises = [];

    // Prepare alert details
    const shiftName = alertData.shift_types?.name || "Unknown Shift";
    const date = alertData.date ? format(new Date(alertData.date), "EEEE, MMM d, yyyy") : "Unknown Date";
    const staffingNeeded = alertData.minimum_required - alertData.current_staffing;
    
    // Use custom message if available, otherwise create default
    const alertMessage = alertData.custom_message || 
      `URGENT: ${staffingNeeded} more officer(s) needed for ${shiftName} shift on ${date}. Current staffing: ${alertData.current_staffing}/${alertData.minimum_required}. Please log in to the scheduling system to sign up if available.`;

    const emailSubject = `🚨 Vacancy Alert - ${shiftName} - ${format(new Date(alertData.date), "MMM d, yyyy")}`;
    
    const emailBody = `
Shift: ${shiftName}
Date: ${date}
Time: ${alertData.shift_types?.start_time} - ${alertData.shift_types?.end_time}
Staffing Needed: ${staffingNeeded} more officer(s)
Current Staffing: ${alertData.current_staffing}/${alertData.minimum_required}

${alertData.custom_message ? `Message: ${alertData.custom_message}` : 'Please log in to the scheduling system to volunteer for this shift.'}

This is an automated vacancy alert. Please do not reply to this message.
    `.trim();

    // Send notifications to each officer based on their preferences
    for (const officer of officers || []) {
      // Use default preferences if none exist
      const preferences = officer.notification_preferences || { 
        receiveEmails: true, 
        receiveTexts: true 
      };
      
      // Send email if enabled and officer has email
      if (preferences.receiveEmails !== false && officer.email) {
        console.log(`Sending email to ${officer.full_name} (${officer.email})`);
        
        emailPromises.push(
          fetch('https://ywghefarrcwbnraqyfgk.supabase.co/functions/v1/send-vacancy-alert', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: officer.email,
              subject: emailSubject,
              message: emailBody,
              alertId: alertData.alertId
            }),
          })
          .then(async (response) => {
            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`Email failed for ${officer.email}: ${errorText}`);
            }
            return response.json();
          })
          .catch(err => {
            console.error(`Failed to send email to ${officer.email}:`, err);
            // Don't throw here - we want to continue with other officers
            return { success: false, error: err.message };
          })
        );
      }

      // Send text if enabled and officer has phone
      if (preferences.receiveTexts !== false && officer.phone) {
        console.log(`Sending text to ${officer.full_name} (${officer.phone})`);
        
        // Prepare text message (shorter version)
        const textMessage = alertData.custom_message || 
          `VACANCY: ${shiftName} on ${format(new Date(alertData.date), "MMM d")}. Need ${staffingNeeded} more. Log in to sign up.`;

        textPromises.push(
          fetch('https://ywghefarrcwbnraqyfgk.supabase.co/functions/v1/send-text-alert', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: officer.phone,
              message: textMessage
            }),
          })
          .then(async (response) => {
            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`Text failed for ${officer.phone}: ${errorText}`);
            }
            return response.json();
          })
          .catch(err => {
            console.error(`Failed to send text to ${officer.phone}:`, err);
            // Don't throw here - we want to continue with other officers
            return { success: false, error: err.message };
          })
        );
      }
    }

    console.log(`Sending ${emailPromises.length} emails and ${textPromises.length} texts`);

    // Wait for all notifications to be sent
    const emailResults = await Promise.allSettled(emailPromises);
    const textResults = await Promise.allSettled(textPromises);

    // Log results for debugging
    const successfulEmails = emailResults.filter(result => 
      result.status === 'fulfilled' && result.value?.success !== false
    ).length;
    
    const successfulTexts = textResults.filter(result => 
      result.status === 'fulfilled' && result.value?.success !== false
    ).length;

    console.log(`Notification results: ${successfulEmails}/${emailPromises.length} emails sent, ${successfulTexts}/${textPromises.length} texts sent`);

    // Update alert status to indicate notification was sent
    const { error } = await supabase
      .from("vacancy_alerts")
      .update({ 
        notification_sent: true,
        notified_at: new Date().toISOString(),
        custom_message: alertData.custom_message || null // Store the custom message if used
      })
      .eq("id", alertData.alertId);

    if (error) {
      console.error("Error updating alert status:", error);
      throw error;
    }

    return {
      emailsSent: successfulEmails,
      textsSent: successfulTexts,
      totalOfficers: officers?.length || 0
    };
  },
  onSuccess: (data) => {
    toast.success(`Alerts sent successfully! ${data.emailsSent} emails and ${data.textsSent} texts delivered to ${data.totalOfficers} officers.`);
    queryClient.invalidateQueries({ queryKey: ["existing-vacancy-alerts"] });
    queryClient.invalidateQueries({ queryKey: ["all-vacancy-alerts"] });
    queryClient.invalidateQueries({ queryKey: ["vacancy-alerts"] });
  },
  onError: (error) => {
    console.error("Send alert error:", error);
    toast.error("Failed to send alerts: " + error.message);
  },
});

const isAlertCreated = (shift: any) => {
  return existingAlerts?.find(alert => 
    alert.date === shift.date && 
    alert.shift_type_id === shift.shift_type_id
  );
};

  const handleCreateAlertFromDetection = (shift: any) => {
    console.log("Opening custom message dialog for shift:", shift);
    
    // Store the shift and show custom message dialog
    setSelectedShiftForCustomMessage(shift);
    setDetectionCustomMessage(""); // Reset any previous message
    setShowCustomMessageDialog(true);
  };
  
  const handleConfirmDetectionAlert = () => {
    if (!selectedShiftForCustomMessage) {
      toast.error("No shift selected");
      return;
    }

    // Create default message if custom message is empty
    const finalMessage = detectionCustomMessage.trim() || 
      `Urgent: ${selectedShiftForCustomMessage.minimum_required - selectedShiftForCustomMessage.current_staffing} more officers needed for ${selectedShiftForCustomMessage.shift_types?.name} shift on ${format(new Date(selectedShiftForCustomMessage.date), "MMM d")}`;

    createAlertMutation.mutate({
      shift_type_id: selectedShiftForCustomMessage.shift_type_id,
      date: selectedShiftForCustomMessage.date,
      current_staffing: selectedShiftForCustomMessage.current_staffing,
      minimum_required: selectedShiftForCustomMessage.minimum_required,
      custom_message: finalMessage
    }, {
      onSuccess: () => {
        setShowCustomMessageDialog(false);
        setSelectedShiftForCustomMessage(null);
        setDetectionCustomMessage("");
        toast.success("Vacancy alert created with custom message");
      }
    });
  };

  const handleCreateAllAlerts = () => {
    if (!understaffedShifts) return;

    const shiftsWithoutAlerts = understaffedShifts.filter(shift => !isAlertCreated(shift));
    
    if (shiftsWithoutAlerts.length === 0) {
      toast.info("All understaffed shifts already have alerts");
      return;
    }

    // Create alerts with default messages
    shiftsWithoutAlerts.forEach(shift => {
      const defaultMessage = `Urgent: ${shift.minimum_required - shift.current_staffing} more officers needed for ${shift.shift_types?.name} shift on ${format(new Date(shift.date), "MMM d")}`;
      
      createAlertMutation.mutate({
        shift_type_id: shift.shift_type_id,
        date: shift.date,
        current_staffing: shift.current_staffing,
        minimum_required: shift.minimum_required,
        custom_message: defaultMessage
      });
    });

    toast.success(`Creating ${shiftsWithoutAlerts.length} alerts with default messages`);
  };

const handleSendAlert = (shift: any) => {
  const alert = existingAlerts?.find(a => 
    a.date === shift.date && a.shift_type_id === shift.shift_type_id
  );

  if (!alert) {
    toast.error("Please create an alert first");
    return;
  }

  // Prepare the data to send
  const alertData = {
    ...shift,
    alertId: alert.id,
    custom_message: alert.custom_message // Include any custom message
  };

  sendAlertMutation.mutate(alertData);
};

  // If this is officer view, hide all create alert functionality
  if (isOfficerView) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold">Vacancy Alerts</h2>
            <p className="text-sm text-muted-foreground">
              Last refreshed: {lastRefreshed.toLocaleTimeString()}
            </p>
          </div>
          <Button variant="outline" onClick={handleRefreshAll}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Show only existing alerts for officers - no create functionality */}
        <Card>
          <CardHeader>
            <CardTitle>Current Vacancy Alerts</CardTitle>
            <CardDescription>Open shifts that need coverage</CardDescription>
          </CardHeader>
          <CardContent>
            {alertsLoading ? (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground">Loading alerts...</p>
              </div>
            ) : !alerts || alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No vacancy alerts at this time.</p>
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
                          {alert.custom_message && (
                            <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded">
                              <p className="text-sm text-blue-800">{alert.custom_message}</p>
                            </div>
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
      </div>
    );
  }

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

      {/* Officer Responses with Approval Workflow */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Officer Responses
          </CardTitle>
          <CardDescription>Review and manage officer responses to vacancy alerts</CardDescription>
        </CardHeader>
        <CardContent>
          {!responses || responses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No responses yet.</p>
          ) : (
            <div className="space-y-4">
              {responses.map((response) => {
                const alert = response.vacancy_alerts;
                const shiftName = alert?.shift_types?.name || "Unknown Shift";
                const date = alert?.date ? format(new Date(alert.date), "MMM d, yyyy") : "Unknown Date";

                return (
                  <div key={response.id} className="p-4 border rounded-lg space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="font-medium">
                            {response.profiles?.full_name} (#{response.profiles?.badge_number})
                          </p>
                          <Badge 
                            variant={getStatusVariant(response.status)}
                            className="flex items-center gap-1 capitalize"
                          >
                            {getStatusIcon(response.status)}
                            {getStatusDisplay(response.status)}
                          </Badge>
                        </div>
                        
                        <p className="text-sm text-muted-foreground">
                          {shiftName} - {date}
                        </p>
                        
                        {response.approved_by && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {response.status === "accepted" ? "Approved" : "Denied"} on{" "}
                            {format(new Date(response.approved_at), "MMM d, yyyy 'at' h:mm a")}
                          </p>
                        )}

                        {response.rejection_reason && (
                          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded">
                            <p className="text-sm text-red-800">
                              <strong>Reason:</strong> {response.rejection_reason}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Action Buttons for Supervisors */}
                      {response.status === "interested" && (
                        <div className="flex flex-col gap-2 ml-4">
                          <Button
                            size="sm"
                            onClick={() => updateResponseMutation.mutate({ 
                              responseId: response.id, 
                              status: "approved" 
                            })}
                            disabled={updateResponseMutation.isPending}
                            className="flex items-center gap-1"
                          >
                            <Check className="h-3 w-3" />
                            Approve
                          </Button>
                          
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={updateResponseMutation.isPending}
                                className="flex items-center gap-1"
                              >
                                <X className="h-3 w-3" />
                                Deny
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Deny Response</DialogTitle>
                                <DialogDescription>
                                  Provide a reason for denying this shift request from {response.profiles?.full_name}.
                                </DialogDescription>
                              </DialogHeader>
                              
                              <div className="space-y-4">
                                <div className="space-y-2">
                                  <Label htmlFor="rejection-reason">Reason for Denial</Label>
                                  <textarea
                                    id="rejection-reason"
                                    placeholder="Enter reason for denial (optional but recommended)"
                                    className="w-full min-h-[80px] p-2 border rounded-md text-sm resize-y"
                                    maxLength={500}
                                  />
                                </div>
                                
                                <Button
                                  onClick={() => {
                                    const textarea = document.getElementById('rejection-reason') as HTMLTextAreaElement;
                                    updateResponseMutation.mutate({ 
                                      responseId: response.id, 
                                      status: "denied",
                                      rejectionReason: textarea.value
                                    });
                                  }}
                                  disabled={updateResponseMutation.isPending}
                                  variant="destructive"
                                >
                                  {updateResponseMutation.isPending ? "Denying..." : "Confirm Denial"}
                                </Button>
                              </div>
                            </DialogContent>
                          </Dialog>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

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
                const existingAlert = isAlertCreated(shift);
                const alertExists = !!existingAlert;
                
                return (
                  <div
                    key={`${shift.date}-${shift.shift_type_id}-${index}`}
                    className="p-4 border rounded-lg space-y-3"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <p className="font-medium">{shift.shift_types?.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(shift.date + 'T12:00:00'), "EEEE, MMM d, yyyy")} • {shift.shift_types?.start_time} - {shift.shift_types?.end_time}
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
                      
                      {/* Button Section */}
                      <div className="flex flex-col gap-2">
                        {!alertExists ? (
                          <Button
                            size="sm"
                            onClick={() => handleCreateAlertFromDetection(shift)}
                            disabled={createAlertMutation.isPending}
                          >
                            {createAlertMutation.isPending ? "Creating..." : "Create Alert"}
                          </Button>
                        ) : (
                          <>
                            {(() => {
                              // Use the main alerts query data which should have notification_sent
                              const mainAlert = alerts?.find(a => 
                                a.date === shift.date && 
                                a.shift_type_id === shift.shift_type_id
                              );
                              
                              if (mainAlert?.notification_sent) {
                                return (
                                  <div className="flex items-center gap-2 px-3 py-2 text-sm text-green-600 bg-green-50 border border-green-200 rounded-md">
                                    <Check className="h-3 w-3" />
                                    Alert Sent
                                    {mainAlert.notified_at && (
                                      <span className="text-xs ml-1">
                                        {format(new Date(mainAlert.notified_at), "MMM d, h:mm a")}
                                      </span>
                                    )}
                                  </div>
                                );
                              } else {
                                return (
                                  <div className="flex flex-col gap-2">
                                    <div className="flex items-center gap-2 px-3 py-2 text-sm text-blue-600 bg-blue-50 border border-blue-200 rounded-md">
                                      <Clock className="h-3 w-3" />
                                      Awaiting Response
                                    </div>
                                    <Button
                                      size="sm"
                                      onClick={() => handleSendAlert(shift)}
                                      disabled={sendAlertMutation.isPending}
                                      variant="outline"
                                    >
                                      <Mail className="h-3 w-3 mr-1" />
                                      {sendAlertMutation.isPending ? "Sending..." : "Send Alert"}
                                    </Button>
                                  </div>
                                );
                              }
                            })()}
                          </>
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
                  <div className="space-y-2">
                    <Label htmlFor="custom-message">Custom Message (Optional)</Label>
                    <textarea
                      id="custom-message"
                      placeholder="Add a custom message for this vacancy alert (e.g., 'Urgent coverage needed for special event')"
                      value={customMessage}
                      onChange={(e) => setCustomMessage(e.target.value)}
                      className="w-full min-h-[80px] p-2 border rounded-md text-sm resize-y"
                      maxLength={500}
                    />
                    <p className="text-xs text-muted-foreground">
                      {customMessage.length}/500 characters
                    </p>
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
                        {/* Add custom message display */}
                        {alert.custom_message && (
                          <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded">
                            <p className="text-sm text-blue-800">{alert.custom_message}</p>
                          </div>
                        )}
                      </div> {/* This closes the flex-1 div */}
<div className="flex flex-col items-end gap-2 ml-4">
  <div className="flex flex-col items-end gap-1">
    <span
      className={cn(
        "text-xs px-2 py-1 rounded",
        alert.status === "open"
          ? alert.notification_sent
            ? "bg-green-500/10 text-green-700"
            : "bg-blue-500/10 text-blue-700"
          : "bg-gray-500/10 text-gray-700"
      )}
    >
      {alert.status === "open" 
        ? (alert.notification_sent ? "Alert Sent" : "Awaiting Response")
        : "Closed"
      }
    </span>
    {alert.notification_sent && alert.notified_at && (
      <span className="text-xs text-muted-foreground">
        Sent: {format(new Date(alert.notified_at), "MMM d, h:mm a")}
      </span>
    )}
  </div>
  {alert.status === "open" && (
    <div className="flex flex-col gap-2">
      {!alert.notification_sent ? (
        <Button
          size="sm"
          onClick={() => {
            const shiftData = {
              ...alert,
              alertId: alert.id,
              shift_types: alert.shift_types
            };
            handleSendAlert(shiftData);
          }}
          disabled={sendAlertMutation.isPending}
        >
          <Mail className="h-3 w-3 mr-1" />
          {sendAlertMutation.isPending ? "Sending..." : "Send Alert"}
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        onClick={() => closeAlertMutation.mutate(alert.id)}
        disabled={closeAlertMutation.isPending}
      >
        {closeAlertMutation.isPending ? "Closing..." : "Close Alert"}
      </Button>
    </div>
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

      {/* Custom Message Dialog for Understaffed Detection */}
      <Dialog open={showCustomMessageDialog} onOpenChange={setShowCustomMessageDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Custom Message</DialogTitle>
            <DialogDescription>
              Add a custom message for the vacancy alert for{" "}
              {selectedShiftForCustomMessage?.shift_types?.name} on{" "}
              {selectedShiftForCustomMessage && format(new Date(selectedShiftForCustomMessage.date), "EEEE, MMM d, yyyy")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Shift Info Summary */}
            {selectedShiftForCustomMessage && (
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm font-medium">
                  {selectedShiftForCustomMessage.shift_types?.name} • {format(new Date(selectedShiftForCustomMessage.date), "MMM d, yyyy")}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Staffing: {selectedShiftForCustomMessage.current_staffing} / {selectedShiftForCustomMessage.minimum_required} • 
                  Needs {selectedShiftForCustomMessage.minimum_required - selectedShiftForCustomMessage.current_staffing} more officers
                </p>
              </div>
            )}

            {/* Custom Message Textarea */}
            <div className="space-y-2">
              <Label htmlFor="detection-custom-message">Custom Message (Optional)</Label>
              <textarea
                id="detection-custom-message"
                placeholder="Add a custom message for this vacancy alert (e.g., 'Urgent coverage needed for special event', 'Mandatory overtime available', etc.)"
                value={detectionCustomMessage}
                onChange={(e) => setDetectionCustomMessage(e.target.value)}
                className="w-full min-h-[100px] p-3 border rounded-md text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
                maxLength={500}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Leave blank to use default message</span>
                <span>{detectionCustomMessage.length}/500 characters</span>
              </div>
            </div>

            {/* Preview of Default Message */}
            {!detectionCustomMessage.trim() && (
              <div className="p-2 bg-blue-50 border border-blue-200 rounded">
                <p className="text-xs text-blue-700 font-medium">Default message that will be used:</p>
                <p className="text-xs text-blue-600 mt-1">
                  Urgent: {selectedShiftForCustomMessage?.minimum_required - selectedShiftForCustomMessage?.current_staffing} more officers needed for {selectedShiftForCustomMessage?.shift_types?.name} shift on {selectedShiftForCustomMessage && format(new Date(selectedShiftForCustomMessage.date), "MMM d")}
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setShowCustomMessageDialog(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmDetectionAlert}
                disabled={createAlertMutation.isPending}
                className="flex-1"
              >
                {createAlertMutation.isPending ? "Creating..." : "Create Alert"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
