import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { format, startOfWeek, addDays, addWeeks, subWeeks, isWithinInterval } from "date-fns";
import { Calendar, Plus, Edit2, Clock, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
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
    existingPTO?: {
      id: string;
      ptoType: string;
      startTime: string;
      endTime: string;
      isFullShift: boolean;
    };
  } | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<string | null>(null);
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(startOfWeek(new Date(), { weekStartsOn: 0 }));
  const queryClient = useQueryClient();

  // Week navigation functions
  const goToPreviousWeek = () => {
    setCurrentWeekStart(subWeeks(currentWeekStart, 1));
  };

  const goToNextWeek = () => {
    setCurrentWeekStart(addWeeks(currentWeekStart, 1));
  };

  const goToCurrentWeek = () => {
    setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 }));
  };

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
    queryKey: ["weekly-schedule", selectedOfficerId, currentWeekStart.toISOString()],
    queryFn: async () => {
      const targetUserId = isAdminOrSupervisor ? selectedOfficerId : userId;
      const weekDates = Array.from({ length: 7 }, (_, i) => 
        format(addDays(currentWeekStart, i), "yyyy-MM-dd")
      );

      // Get recurring schedules - filter by active schedules for the current week
      const { data: recurringData, error: recurringError } = await supabase
        .from("recurring_schedules")
        .select(`
          *,
          shift_types(name, start_time, end_time)
        `)
        .eq("officer_id", targetUserId)
        // Filter recurring schedules that are active during the current week
        .lte("start_date", format(addDays(currentWeekStart, 6), "yyyy-MM-dd")) // Start date before end of week
        .or(`end_date.is.null,end_date.gte.${format(currentWeekStart, "yyyy-MM-dd")}`); // End date after start of week or null

      if (recurringError) {
        console.error("Recurring error:", recurringError);
        throw recurringError;
      }

      // Get exceptions for the specific week
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
        
        // Find recurring schedule for this day of week that's active on this date
        const recurring = recurringData?.find(r => {
          if (r.day_of_week !== dayOfWeek) return false;
          
          // Check if the recurring schedule is active on this specific date
          const scheduleStartDate = new Date(r.start_date);
          const scheduleEndDate = r.end_date ? new Date(r.end_date) : null;
          const currentDate = new Date(date);
          
          // Schedule is active if:
          // 1. Current date is on or after start date
          // 2. AND current date is on or before end date (if end date exists)
          const isAfterStart = currentDate >= scheduleStartDate;
          const isBeforeEnd = !scheduleEndDate || currentDate <= scheduleEndDate;
          
          return isAfterStart && isBeforeEnd;
        });

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
            reason: exception.reason,
            // Add PTO detection
            hasPTO: exception.is_off,
            ptoData: exception.is_off ? {
              id: exception.id,
              ptoType: exception.reason,
              startTime: exception.custom_start_time || exception.shift_types?.start_time,
              endTime: exception.custom_end_time || exception.shift_types?.end_time,
              isFullShift: !exception.custom_start_time && !exception.custom_end_time
            } : undefined
          };
        } else if (recurring) {
          // For recurring schedules, check if there's a PTO exception for this date
          const ptoException = exceptionsData?.find(e => 
            e.officer_id === targetUserId && 
            e.date === date && 
            e.is_off
          );
          
          shiftInfo = {
            type: recurring.shift_types?.name,
            time: `${recurring.shift_types?.start_time} - ${recurring.shift_types?.end_time}`,
            position: recurring.position_name,
            scheduleId: recurring.id,
            scheduleType: "recurring" as const,
            shift: recurring.shift_types,
            isOff: false,
            // Add PTO detection
            hasPTO: !!ptoException,
            ptoData: ptoException ? {
              id: ptoException.id,
              ptoType: ptoException.reason,
              startTime: ptoException.custom_start_time || recurring.shift_types?.start_time,
              endTime: ptoException.custom_end_time || recurring.shift_types?.end_time,
              isFullShift: !ptoException.custom_start_time && !ptoException.custom_end_time
            } : undefined
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

  // Add mutation for removing PTO
  const removePTOMutation = useMutation({
    mutationFn: async (ptoData: { id: string; officerId: string; date: string; shiftTypeId: string; ptoType: string; startTime: string; endTime: string }) => {
      // Calculate hours to restore
      const calculateHours = (start: string, end: string) => {
        const [startHour, startMin] = start.split(":").map(Number);
        const [endHour, endMin] = end.split(":").map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;
        return (endMinutes - startMinutes) / 60;
      };

      const hoursUsed = calculateHours(ptoData.startTime, ptoData.endTime);

      // Restore PTO balance
      const PTO_TYPES = [
        { value: "vacation", label: "Vacation", column: "vacation_hours" },
        { value: "holiday", label: "Holiday", column: "holiday_hours" },
        { value: "sick", label: "Sick", column: "sick_hours" },
        { value: "comp", label: "Comp", column: "comp_hours" },
      ];

      const ptoColumn = PTO_TYPES.find((t) => t.value === ptoData.ptoType)?.column;
      if (ptoColumn) {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", ptoData.officerId)
          .single();

        if (profileError) throw profileError;

        const currentBalance = profile[ptoColumn as keyof typeof profile] as number;
        
        const { error: restoreError } = await supabase
          .from("profiles")
          .update({
            [ptoColumn]: currentBalance + hoursUsed,
          })
          .eq("id", ptoData.officerId);

        if (restoreError) throw restoreError;
      }

      // Delete the PTO exception
      const { error: deleteError } = await supabase
        .from("schedule_exceptions")
        .delete()
        .eq("id", ptoData.id);

      if (deleteError) throw deleteError;

      // Also delete any associated working time exception
      await supabase
        .from("schedule_exceptions")
        .delete()
        .eq("officer_id", ptoData.officerId)
        .eq("date", ptoData.date)
        .eq("shift_type_id", ptoData.shiftTypeId)
        .eq("is_off", false);
    },
    onSuccess: () => {
      toast.success("PTO removed and balance restored");
      queryClient.invalidateQueries({ queryKey: ["weekly-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to remove PTO");
    },
  });

  const handleSavePosition = (scheduleId: string, type: "recurring" | "exception", positionName: string) => {
    updatePositionMutation.mutate(
      { scheduleId, type, positionName },
      {
        onSuccess: () => {
          // Force refresh the weekly schedule data
          queryClient.invalidateQueries({ 
            queryKey: ["weekly-schedule", selectedOfficerId, currentWeekStart.toISOString()] 
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
      shift: schedule.shift,
      // Pass existing PTO data if available
      ...(schedule.hasPTO && schedule.ptoData ? { existingPTO: schedule.ptoData } : {})
    });
    setPtoDialogOpen(true);
  };

  const handleRemovePTO = (schedule: any, date: string) => {
    if (!schedule.hasPTO || !schedule.ptoData) return;

    const ptoData = {
      id: schedule.ptoData.id,
      officerId: selectedOfficerId,
      date: date,
      shiftTypeId: schedule.shift.id,
      ptoType: schedule.ptoData.ptoType,
      startTime: schedule.ptoData.startTime,
      endTime: schedule.ptoData.endTime
    };

    removePTOMutation.mutate(ptoData);
  };

  // Function to refresh the weekly schedule data
  const refreshWeeklySchedule = () => {
    queryClient.invalidateQueries({ 
      queryKey: ["weekly-schedule", selectedOfficerId, currentWeekStart.toISOString()] 
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
  const weekEnd = addDays(currentWeekStart, 6);
  const isCurrentWeek = startOfWeek(new Date(), { weekStartsOn: 0 }).getTime() === currentWeekStart.getTime();

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Weekly Schedule
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
          
          {/* Week Navigation */}
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={goToPreviousWeek}
                title="Previous Week"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              
              <div className="text-center">
                <h3 className="text-lg font-semibold">
                  {format(currentWeekStart, "MMM d")} - {format(weekEnd, "MMM d, yyyy")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  Week of {format(currentWeekStart, "MMMM d, yyyy")}
                </p>
              </div>
              
              <Button
                variant="outline"
                size="sm"
                onClick={goToNextWeek}
                title="Next Week"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            
            <Button
              variant={isCurrentWeek ? "outline" : "default"}
              size="sm"
              onClick={goToCurrentWeek}
              disabled={isCurrentWeek}
            >
              Today
            </Button>
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
                        
                        {isAdminOrSupervisor && (
                          <div className="flex items-center gap-2">
                            {!shiftInfo.isOff && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleEditClick(shiftInfo)}
                                title="Edit Position"
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                            )}
                            {shiftInfo.hasPTO ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => handleAssignPTO(shiftInfo, date)}
                                  title="Edit PTO"
                                >
                                  <Clock className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleRemovePTO(shiftInfo, date)}
                                  disabled={removePTOMutation.isPending}
                                  title="Remove PTO"
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleAssignPTO(shiftInfo, date)}
                                title="Assign PTO"
                              >
                                <Clock className="h-4 w-4" />
                              </Button>
                            )}
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
                type: selectedSchedule.type,
                ...(selectedSchedule.existingPTO ? { existingPTO: selectedSchedule.existingPTO } : {})
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
