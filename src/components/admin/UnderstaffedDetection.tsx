// this is a test email, use production when ready
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
import { useState, useEffect } from "react";

export const UnderstaffedDetection = () => {
  const queryClient = useQueryClient();
  const [selectedShiftId, setSelectedShiftId] = useState<string>("all");
  const [sentAlerts, setSentAlerts] = useState<Set<string>>(new Set());

  // Load sent alerts from localStorage on component mount
  useEffect(() => {
    const savedSentAlerts = localStorage.getItem('sentVacancyAlerts');
    if (savedSentAlerts) {
      try {
        const alertsArray = JSON.parse(savedSentAlerts);
        setSentAlerts(new Set(alertsArray));
      } catch (error) {
        console.error('Error loading sent alerts from localStorage:', error);
      }
    }
  }, []);

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

      console.log("📅 Checking dates:", dates, "for shift:", selectedShiftId);

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

          // Get ALL schedule data for this date - using the same logic as DailyScheduleView
          const { data: dailyScheduleData, error: dailyError } = await supabase
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

          if (dailyError) {
            console.error("❌ Recurring schedules error:", dailyError);
            throw dailyError;
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
            const minOfficers = minStaff?.minimum_officers || 2;

            console.log(`\n🔍 Checking shift: ${shift.name} (${shift.start_time} - ${shift.end_time})`);
            console.log(`📋 Min requirements: ${minSupervisors} supervisors, ${minOfficers} officers`);

            // Build the schedule exactly like DailyScheduleView does
            const allAssignedOfficers = [];

            // Process recurring officers - check if they have working exceptions that override their position
            const recurringOfficers = dailyScheduleData
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
              const isSupervisor = actualPosition?.toLowerCase().includes('supervisor');

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
                !dailyScheduleData?.some(r => r.officer_id === e.officer_id)
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

              const isSupervisor = additionalOfficer.position_name?.toLowerCase().includes('supervisor');
              
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
      console.log("⚠️ Alert already exists, returning existing alert");
      return existingAlert; // Return the existing alert instead of throwing error
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

    if (error) {
      // If it's a duplicate error, try to fetch the existing alert
      if (error.code === '23505') {
        console.log("🔄 Duplicate alert detected, fetching existing alert");
        const { data: existingData } = await supabase
          .from("vacancy_alerts")
          .select("*")
          .eq("date", shiftData.date)
          .eq("shift_type_id", shiftData.shift_type_id)
          .eq("status", "open")
          .single();
        
        if (existingData) {
          return existingData;
        }
      }
      throw error;
    }
    return data;
  },
  onSuccess: (data) => {
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
    // 🟡 TEST MODE - Comment out production code below and use this for testing
    console.log("🔄 TEST MODE: Sending to single test email");

    // TEST EMAIL - Change this to your test email
    const TEST_EMAIL = "brandon.lavin@portarthurtx.gov"; // Use your actual email
    
    // Prepare alert details
    const shiftName = alertData.shift_types?.name || "Unknown Shift";
    const date = alertData.date ? format(new Date(alertData.date), "EEEE, MMM d, yyyy") : "Unknown Date";
    const staffingNeeded = alertData.minimum_required - alertData.current_staffing;
    
    // Email content
    const emailSubject = `🚨 TEST - Vacancy Alert - ${shiftName} - ${format(new Date(alertData.date), "MMM d, yyyy")}`;
    const emailBody = `
TEST MODE - This is a test vacancy alert:

Shift: ${shiftName}
Date: ${date}
Time: ${alertData.shift_types?.start_time} - ${alertData.shift_types?.end_time}
Staffing Needed: ${staffingNeeded} more officer(s)
Current Staffing: ${alertData.current_staffing}/${alertData.minimum_required}

This is a TEST email. Please ignore.

Alert ID: ${alertData.alertId}
    `.trim();

    console.log(`📧 Sending TEST email to: ${TEST_EMAIL}`);
    console.log(`📧 Email subject: ${emailSubject}`);
    
    try {
      // Send only to test email
      const response = await fetch('https://ywghefarrcwbnraqyfgk.supabase.co/functions/v1/send-vacancy-alert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        // Remove Authorization header for now since the edge function doesn't require it
        body: JSON.stringify({
          to: TEST_EMAIL,
          subject: emailSubject,
          message: emailBody,
          alertId: alertData.alertId
        }),
      });

      console.log(`📧 Response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`📧 Response error text:`, errorText);
        throw new Error(`Test email failed with status ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log('📧 Test email result:', result);

      return { 
        success: true, 
        testEmail: TEST_EMAIL,
        alertId: alertData.alertId,
        message: 'Test email sent successfully',
        result: result
      };
    } catch (error) {
      console.error('📧 Fetch error:', error);
      throw error;
    }

    // 🟢 PRODUCTION CODE - Comment out the above test code and uncomment below for production
    /*
    [Your production code here]
    */
  },
  onSuccess: (data) => {
    // 🟡 TEST MODE - Use this for testing
    toast.success(`✅ Test alert sent to ${data.testEmail}`);
    console.log('✅ Send alert success data:', data);
    
    // 🟢 PRODUCTION CODE - Comment out above and uncomment below for production
    /*
    toast.success(`Alerts sent successfully! ${data.emailsSent} emails and ${data.textsSent} texts delivered.`);
    */
  },
  onError: (error) => {
    console.error("❌ Send alert error:", error);
    toast.error("Failed to send alerts: " + error.message);
  },
});

        // Send real text via Twilio
        if (preferences.receiveTexts !== false && officer.phone) {
          console.log(`📱 Sending REAL text to ${officer.full_name} (${officer.phone})`);
          
          textPromises.push(
            fetch('https://ywghefarrcwbnraqyfgk.supabase.co/functions/v1/send-text-alert', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}` // Add auth header
              },
              body: JSON.stringify({
                to: officer.phone,
                message: textMessage
              }),
            }).then(async (response) => {
              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Text failed for ${officer.phone}: ${errorText}`);
              }
              return response.json();
            }).catch(err => {
              console.error(`Failed to send text to ${officer.phone}:`, err);
              throw err; // Re-throw to fail the entire mutation
            })
          );
        }
      }

      console.log(`Sending ${emailPromises.length} emails and ${textPromises.length} texts`);

      // Wait for all notifications to complete
      const [emailResults, textResults] = await Promise.all([
        Promise.allSettled(emailPromises),
        Promise.allSettled(textPromises)
      ]);

      // Count successful notifications
      const successfulEmails = emailResults.filter(result => 
        result.status === 'fulfilled'
      ).length;
      
      const successfulTexts = textResults.filter(result => 
        result.status === 'fulfilled'
      ).length;

      console.log(`Successfully sent ${successfulEmails}/${emailPromises.length} emails and ${successfulTexts}/${textPromises.length} texts`);

      // Check if any critical failures occurred
      const failedEmails = emailResults.filter(result => 
        result.status === 'rejected'
      );
      
      const failedTexts = textResults.filter(result => 
        result.status === 'rejected'
      );

      if (failedEmails.length > 0 || failedTexts.length > 0) {
        console.error('Some notifications failed:', { failedEmails, failedTexts });
        // You might want to throw an error here if any critical failures occur
        // throw new Error(`${failedEmails.length} emails and ${failedTexts.length} texts failed to send`);
      }

      // Return success with counts
      return { 
        success: true, 
        emailsSent: successfulEmails,
        textsSent: successfulTexts,
        alertId: alertData.alertId,
        totalOfficers: officers?.length || 0
      };
    },
    onSuccess: (data) => {
      toast.success(`Alerts sent successfully! ${data.emailsSent} emails and ${data.textsSent} texts delivered.`);
    },
    onError: (error) => {
      console.error("Send alert error:", error);
      toast.error("Failed to send alerts: " + error.message);
    },
  });

  const isAlertSent = (shift: any) => {
    const existingAlert = existingAlerts?.find(a => 
      a.date === shift.date && a.shift_type_id === shift.shift_type_id
    );
    return existingAlert ? sentAlerts.has(existingAlert.id) : false;
  };

const handleSendAlert = (shift: any) => {
  const alert = existingAlerts?.find(a => 
    a.date === shift.date && a.shift_type_id === shift.shift_type_id
  );

  if (!alert) {
    toast.error("Please create an alert first");
    return;
  }

  // Check if already sent
  if (sentAlerts.has(alert.id)) {
    toast.info("Alert has already been sent");
    return;
  }

  console.log(`🔄 Starting send process for alert:`, alert);

  sendAlertMutation.mutate({
    ...shift,
    alertId: alert.id
  }, {
    onSuccess: (data) => {
      // Track this alert as sent locally and save to localStorage
      const newSentAlerts = new Set(sentAlerts).add(alert.id);
      setSentAlerts(newSentAlerts);
      localStorage.setItem('sentVacancyAlerts', JSON.stringify([...newSentAlerts]));
      console.log(`✅ Alert ${alert.id} marked as sent locally`);
      
      // Refresh the UI
      queryClient.invalidateQueries({ queryKey: ["existing-vacancy-alerts"] });
    },
    onError: (error) => {
      console.error(`❌ Failed to send alert ${alert.id}:`, error);
    }
  });
};

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
    return existingAlerts?.find(alert => 
      alert.date === shift.date && 
      alert.shift_type_id === shift.shift_type_id
    );
  };

  const isAlertSent = (shift: any) => {
    const existingAlert = existingAlerts?.find(a => 
      a.date === shift.date && a.shift_type_id === shift.shift_type_id
    );
    return existingAlert ? sentAlerts.has(existingAlert.id) : false;
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

    // Check if already sent
    if (sentAlerts.has(alert.id)) {
      toast.info("Alert has already been sent");
      return;
    }

    sendAlertMutation.mutate({
      ...shift,
      alertId: alert.id
    }, {
      onSuccess: (data) => {
        // Track this alert as sent locally and save to localStorage
        const newSentAlerts = new Set(sentAlerts).add(alert.id);
        setSentAlerts(newSentAlerts);
        localStorage.setItem('sentVacancyAlerts', JSON.stringify([...newSentAlerts]));
        console.log(`✅ Alert ${alert.id} marked as sent locally`);
        
        // Refresh the UI
        queryClient.invalidateQueries({ queryKey: ["existing-vacancy-alerts"] });
      }
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
              const existingAlert = isAlertCreated(shift);
              const alertExists = !!existingAlert;
              const isSent = isAlertSent(shift);
              
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
                        <p className="text-gray-500 mt-1">
                          <strong>Assigned:</strong> {shift.assigned_officers?.map(o => `${o.name} (${o.position || 'No position'})`).join(', ') || 'None'}
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
                        {isSent && (
                          <Badge variant="outline" className="bg-blue-500/10 text-blue-700">
                            Alert Sent
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
                          {createAlertMutation.isPending ? "Creating..." : "Create Alert"}
                        </Button>
                      ) : (
                        <>
                          {isSent ? (
                            <div className="flex items-center gap-2 px-3 py-2 text-sm text-green-600 bg-green-50 border border-green-200 rounded-md">
                              <Mail className="h-3 w-3" />
                              Alert Sent
                            </div>
                          ) : (
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center gap-2 px-3 py-2 text-sm text-blue-600 bg-blue-50 border border-blue-200 rounded-md">
                                <Mail className="h-3 w-3" />
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
                          )}
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
  );
};
