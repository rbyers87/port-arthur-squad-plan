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

              // Get minimum staffing for this specific shift from the database
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

  // ... rest of the component remains the same as previous version
  // (createAlertMutation, sendAlertMutation, refreshMutation, etc.)

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
              onClick={() => refetch()}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              variant="outline"
              onClick={handleCreateAllAlerts}
              disabled={!understaffedShifts?.length}
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

// SIMPLIFIED version that reuses the getScheduleData function from DailyScheduleView
async function getScheduleDataForUnderstaffing(selectedDate: Date, filterShiftId: string = "all") {
  // Import the working function from DailyScheduleView
  const { getScheduleData } = await import('./DailyScheduleView');
  return getScheduleData(selectedDate, filterShiftId);
}
