import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { format, startOfWeek, addDays } from "date-fns";
import { Calendar, Plus, Edit2, Clock } from "lucide-react";
import { ScheduleManagementDialog } from "./ScheduleManagementDialog";
import { PTOAssignmentDialog } from "./PTOAssignmentDialog";
import { PositionEditor } from "./PositionEditor";
import { usePositionMutation } from "@/hooks/usePositionMutation";
import { toast } from "sonner";

interface WeeklyScheduleProps {
  userId: string;
  isAdminOrSupervisor: boolean;
}

export const WeeklySchedule = ({ userId, isAdminOrSupervisor }: WeeklyScheduleProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [ptoDialogOpen, setPtoDialogOpen] = useState(false);
  const [selectedOfficerId, setSelectedOfficerId] = useState<string>(userId);
  const [selectedSchedule, setSelectedSchedule] = useState<{
    scheduleId: string;
    type: "recurring" | "exception";
    date: string;
    shift: any;
  } | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<string | null>(null);
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
  const queryClient = useQueryClient();

  // Function to extract last name from full name
  const getLastName = (fullName: string) => {
    const names = fullName.trim().split(/\s+/);
    return names[names.length - 1] || fullName;
  };

  // Fetch all profiles for admin/supervisor selection
  const { data: profiles, isLoading: profilesLoading } = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, badge_number")
        .order("full_name");
      if (error) throw error;
      
      // Sort by last name alphabetically
      return data.sort((a, b) => {
        const lastNameA = getLastName(a.full_name || "").toLowerCase();
        const lastNameB = getLastName(b.full_name || "").toLowerCase();
        return lastNameA.localeCompare(lastNameB);
      });
    },
    enabled: isAdminOrSupervisor,
  });

  const { data: schedules, isLoading: schedulesLoading, error, refetch } = useQuery({
    queryKey: ["weekly-schedule", selectedOfficerId, weekStart.toISOString()],
    queryFn: async () => {
      const targetUserId = isAdminOrSupervisor ? selectedOfficerId : userId;
      const weekDates = Array.from({ length: 7 }, (_, i) => 
        format(addDays(weekStart, i), "yyyy-MM-dd")
      );

      // Get recurring schedules
      const { data: recurringData, error: recurringError } = await supabase
        .from("recurring_schedules")
        .select(`
          *,
          shift_types(name, start_time, end_time)
        `)
        .eq("officer_id", targetUserId);

      if (recurringError) {
        console.error("Recurring error:", recurringError);
        throw recurringError;
      }

      // Get exceptions
      const { data: exceptionsData, error: exceptionsError } = await supabase
        .from("schedule_exceptions")
        .select(`
          *,
          shift_types(name, start_time, end_time)
        `)
        .eq("officer_id", targetUserId)
        .in("date", weekDates);

      if (exceptionsError) {
        console.error("Exceptions error:", exceptionsError);
        throw exceptionsError;
      }

      // Build schedule for each day
      const dailySchedules = weekDates.map((date, idx) => {
        const dayOfWeek = idx; // 0 = Sunday, 1 = Monday, etc.
        const exception = exceptionsData?.find(e => e.date === date);
        const recurring = recurringData?.find(r => r.day_of_week === dayOfWeek);

        let shiftInfo = null;
        
        if (exception) {
          shiftInfo = {
            type: exception.is_off ? "Off" : (exception.shift_types?.name || "Custom"),
            time: exception.is_off ? "" : (
              exception.custom_start_time && exception.custom_end_time
                ? `${exception.custom_start_time} - ${exception.custom_end_time}`
                : `${exception.shift_types?.start_time} - ${exception.shift_types?.end_time}`
            ),
            position: exception.position_name,
            scheduleId: exception.id,
            scheduleType: "exception" as const,
            shift: exception.shift_types,
            isOff: exception.is_off,
            reason: exception.reason
          };
        } else if (recurring) {
          shiftInfo = {
            type: recurring.shift_types?.name,
            time: `${recurring.shift_types?.start_time} - ${recurring.shift_types?.end_time}`,
            position: recurring.position_name,
            scheduleId: recurring.id,
            scheduleType: "recurring" as const,
            shift: recurring.shift_types,
            isOff: false
          };
        }

        return {
          date,
          dayOfWeek,
          shiftInfo,
          hasSchedule: !!shiftInfo
        };
      });

      return { 
        dailySchedules, 
        weekDates,
        recurring: recurringData,
        exceptions: exceptionsData 
      };
    },
  });

  const updatePositionMutation = usePositionMutation();

  const handleSavePosition = (scheduleId: string, type: "recurring" | "exception", positionName: string) => {
    updatePositionMutation.mutate(
      { scheduleId, type, positionName },
      {
        onSuccess: () => {
          // Force refresh the weekly schedule data
          queryClient.invalidateQueries({ 
            queryKey: ["weekly-schedule", selectedOfficerId, weekStart.toISOString()] 
          });
          setEditingSchedule(null);
        }
      }
    );
  };

  const handleEditClick = (shiftInfo: any) => {
    const scheduleKey = `${shiftInfo.scheduleId}-${shiftInfo.scheduleType}`;
    setEditingSchedule(scheduleKey);
  };

  const handleAssignPTO = (schedule: any, date: string) => {
    setSelectedSchedule({
      scheduleId: schedule.scheduleId,
      type: schedule.scheduleType,
      date: date,
      shift: schedule.shift
    });
    setPtoDialogOpen(true);
  };

  // Function to refresh the weekly schedule data
  const refreshWeeklySchedule = () => {
    queryClient.invalidateQueries({ 
      queryKey: ["weekly-schedule", selectedOfficerId, weekStart.toISOString()] 
    });
  };

  const isLoading = schedulesLoading || (isAdminOrSupervisor && profilesLoading);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Weekly Schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Weekly Schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-500">Error loading schedule: {(error as Error).message}</p>
          <p className="text-sm text-muted-foreground mt-2">
            Please check the console for more details.
          </p>
        </CardContent>
      </Card>
    );
  }

  const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Weekly Schedule - {format(weekStart, "MMM d")} - {format(addDays(weekStart, 6), "MMM d, yyyy")}
            </CardTitle>
            {isAdminOrSupervisor && (
              <div className="flex items-center gap-3">
                <Select value={selectedOfficerId} onValueChange={setSelectedOfficerId}>
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="Select officer" />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles?.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.full_name} (Badge: {profile.badge_number})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={() => setDialogOpen(true)} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Schedule
                </Button>
              </div>
            )}
          </div>
          {isAdminOrSupervisor && selectedOfficerId && (
            <p className="text-sm text-muted-foreground mt-2">
              Viewing schedule for: {profiles?.find(p => p.id === selectedOfficerId)?.full_name}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {schedules?.dailySchedules?.map(({ date, dayOfWeek, shiftInfo }) => (
              <div
                key={date}
                className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
              >
                <div className="space-y-1 flex-1">
                  <p className="font-medium">{daysOfWeek[dayOfWeek]}</p>
                  <p className="text-sm text-muted-foreground">{format(new Date(date), "MMM d")}</p>
                </div>
                
                {shiftInfo ? (
                  <div className="flex items-center gap-4">
                    {editingSchedule === `${shiftInfo.scheduleId}-${shiftInfo.scheduleType}` ? (
                      <PositionEditor
                        currentPosition={shiftInfo.position || ""}
                        onSave={(positionName) => handleSavePosition(shiftInfo.scheduleId, shiftInfo.scheduleType, positionName)}
                        onCancel={() => setEditingSchedule(null)}
                        isSaving={updatePositionMutation.isPending}
                      />
                    ) : (
                      <>
                        <div className="text-right">
                          <p className="font-medium">{shiftInfo.type}</p>
                          {shiftInfo.time && <p className="text-sm text-muted-foreground">{shiftInfo.time}</p>}
                          {shiftInfo.position && (
                            <Badge variant="secondary" className="mt-1">
                              {shiftInfo.position}
                            </Badge>
                          )}
                          {shiftInfo.isOff && (
                            <Badge variant="destructive" className="mt-1">
                              {shiftInfo.reason || "Time Off"}
                            </Badge>
                          )}
                        </div>
                        
                        {isAdminOrSupervisor && !shiftInfo.isOff && (
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleEditClick(shiftInfo)}
                              title="Edit Position"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleAssignPTO(shiftInfo, date)}
                              title="Assign PTO"
                            >
                              <Clock className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <p className="text-sm text-muted-foreground">No shift scheduled</p>
                    {isAdminOrSupervisor && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toast.info("Add schedule feature coming soon")}
                      >
                        Add Shift
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {isAdminOrSupervisor && (
        <>
          <ScheduleManagementDialog open={dialogOpen} onOpenChange={setDialogOpen} />
          {selectedSchedule && (
            <PTOAssignmentDialog
              open={ptoDialogOpen}
              onOpenChange={(open) => {
                setPtoDialogOpen(open);
                // Refresh the weekly schedule when the PTO dialog closes
                if (!open) {
                  refreshWeeklySchedule();
                }
              }}
              officer={{
                officerId: selectedOfficerId,
                name: profiles?.find(p => p.id === selectedOfficerId)?.full_name || "Unknown",
                scheduleId: selectedSchedule.scheduleId,
                type: selectedSchedule.type
              }}
              shift={selectedSchedule.shift}
              date={selectedSchedule.date}
            />
          )}
        </>
      )}
    </>
  );
};
