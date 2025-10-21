import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, startOfWeek, addDays, addWeeks, subWeeks, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, parseISO } from "date-fns";
import { Calendar, Plus, Edit2, Clock, Trash2, ChevronLeft, ChevronRight, Grid, Calendar as CalendarIcon } from "lucide-react";
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
  const [selectedShiftId, setSelectedShiftId] = useState<string>("all");
  const [selectedSchedule, setSelectedSchedule] = useState<{
    scheduleId: string;
    type: "recurring" | "exception";
    date: string;
    shift: any;
    officerId: string;
    officerName: string;
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
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [activeView, setActiveView] = useState<"weekly" | "monthly">("weekly");
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

  // Month navigation functions
  const goToPreviousMonth = () => {
    setCurrentMonth(subMonths(currentMonth, 1));
  };

  const goToNextMonth = () => {
    setCurrentMonth(addMonths(currentMonth, 1));
  };

  const goToCurrentMonth = () => {
    setCurrentMonth(new Date());
  };

  // Fetch all shift types for the filter
  const { data: shiftTypes, isLoading: shiftsLoading } = useQuery({
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

  // Enhanced query to fetch schedule data for ALL officers in selected shift
  const { data: schedules, isLoading: schedulesLoading, error, refetch } = useQuery({
    queryKey: ["schedule", currentWeekStart.toISOString(), currentMonth.toISOString(), activeView, selectedShiftId],
    queryFn: async () => {
      // Determine date range based on active view
      let startDate: Date;
      let endDate: Date;
      let dates: string[];

      if (activeView === "weekly") {
        const weekStart = startOfWeek(currentWeekStart, { weekStartsOn: 0 });
        startDate = weekStart;
        endDate = addDays(weekStart, 6);
        dates = Array.from({ length: 7 }, (_, i) => 
          format(addDays(weekStart, i), "yyyy-MM-dd")
        );
      } else {
        // Monthly view
        startDate = startOfMonth(currentMonth);
        endDate = endOfMonth(currentMonth);
        const monthDays = eachDayOfInterval({ start: startDate, end: endDate });
        dates = monthDays.map(day => format(day, "yyyy-MM-dd"));
      }

      // Base queries for recurring schedules and exceptions
      const recurringQuery = supabase
        .from("recurring_schedules")
        .select(`
          *,
          shift_types(name, start_time, end_time),
          profiles!inner(id, full_name, badge_number, rank)
        `)
        .lte("start_date", format(endDate, "yyyy-MM-dd"))
        .or(`end_date.is.null,end_date.gte.${format(startDate, "yyyy-MM-dd")}`);

      // Add shift filter if not "all"
      if (selectedShiftId !== "all") {
        recurringQuery.eq("shift_type_id", selectedShiftId);
      }

      const { data: recurringData, error: recurringError } = await recurringQuery;

      if (recurringError) {
        console.error("Recurring error:", recurringError);
        throw recurringError;
      }

      // Get exceptions for the specific period
      const exceptionsQuery = supabase
        .from("schedule_exceptions")
        .select(`
          *,
          shift_types(name, start_time, end_time),
          profiles!inner(id, full_name, badge_number, rank)
        `)
        .in("date", dates);

      // Add shift filter if not "all"
      if (selectedShiftId !== "all") {
        exceptionsQuery.eq("shift_type_id", selectedShiftId);
      }

      const { data: exceptionsData, error: exceptionsError } = await exceptionsQuery;

      if (exceptionsError) {
        console.error("Exceptions error:", exceptionsError);
        throw exceptionsError;
      }

      // Build schedule structure by date and officer
      const scheduleByDateAndOfficer: Record<string, Record<string, any>> = {};

      // Initialize structure for all dates
      dates.forEach(date => {
        scheduleByDateAndOfficer[date] = {};
      });

      // Process recurring schedules
      recurringData?.forEach(recurring => {
        dates.forEach(date => {
          const currentDate = parseISO(date);
          const dayOfWeek = currentDate.getDay();
          
          if (recurring.day_of_week === dayOfWeek) {
            const scheduleStartDate = parseISO(recurring.start_date);
            const scheduleEndDate = recurring.end_date ? parseISO(recurring.end_date) : null;
            
            const isAfterStart = currentDate >= scheduleStartDate;
            const isBeforeEnd = !scheduleEndDate || currentDate <= scheduleEndDate;
            
            if (isAfterStart && isBeforeEnd) {
              // Check if there's an exception for this officer/date
              const exception = exceptionsData?.find(e => 
                e.officer_id === recurring.officer_id && 
                e.date === date && 
                !e.is_off
              );

              const ptoException = exceptionsData?.find(e => 
                e.officer_id === recurring.officer_id && 
                e.date === date && 
                e.is_off
              );

              if (!scheduleByDateAndOfficer[date][recurring.officer_id]) {
                scheduleByDateAndOfficer[date][recurring.officer_id] = {
                  officerId: recurring.officer_id,
                  officerName: recurring.profiles?.full_name || "Unknown",
                  badgeNumber: recurring.profiles?.badge_number,
                  rank: recurring.profiles?.rank,
                  date: date,
                  dayOfWeek: dayOfWeek,
                  shiftInfo: {
                    type: recurring.shift_types?.name,
                    time: `${recurring.shift_types?.start_time} - ${recurring.shift_types?.end_time}`,
                    position: recurring.position_name,
                    scheduleId: recurring.id,
                    scheduleType: "recurring" as const,
                    shift: recurring.shift_types,
                    isOff: false,
                    hasPTO: !!ptoException,
                    ptoData: ptoException ? {
                      id: ptoException.id,
                      ptoType: ptoException.reason,
                      startTime: ptoException.custom_start_time || recurring.shift_types?.start_time,
                      endTime: ptoException.custom_end_time || recurring.shift_types?.end_time,
                      isFullShift: !ptoException.custom_start_time && !ptoException.custom_end_time,
                      shiftTypeId: ptoException.shift_type_id
                    } : undefined
                  }
                };
              }
            }
          }
        });
      });

      // Process working exceptions (manually added shifts)
      exceptionsData?.filter(e => !e.is_off).forEach(exception => {
        if (!scheduleByDateAndOfficer[exception.date]) {
          scheduleByDateAndOfficer[exception.date] = {};
        }

        const ptoException = exceptionsData?.find(e => 
          e.officer_id === exception.officer_id && 
          e.date === exception.date && 
          e.is_off
        );

        scheduleByDateAndOfficer[exception.date][exception.officer_id] = {
          officerId: exception.officer_id,
          officerName: exception.profiles?.full_name || "Unknown",
          badgeNumber: exception.profiles?.badge_number,
          rank: exception.profiles?.rank,
          date: exception.date,
          dayOfWeek: parseISO(exception.date).getDay(),
          shiftInfo: {
            type: exception.shift_types?.name || "Custom",
            time: exception.custom_start_time && exception.custom_end_time
              ? `${exception.custom_start_time} - ${exception.custom_end_time}`
              : `${exception.shift_types?.start_time} - ${exception.shift_types?.end_time}`,
            position: exception.position_name,
            scheduleId: exception.id,
            scheduleType: "exception" as const,
            shift: exception.shift_types,
            isOff: false,
            hasPTO: !!ptoException,
            ptoData: ptoException ? {
              id: ptoException.id,
              ptoType: ptoException.reason,
              startTime: ptoException.custom_start_time || exception.shift_types?.start_time,
              endTime: ptoException.custom_end_time || exception.shift_types?.end_time,
              isFullShift: !ptoException.custom_start_time && !ptoException.custom_end_time,
              shiftTypeId: ptoException.shift_type_id
            } : undefined
          }
        };
      });

      // Process PTO-only exceptions (officers with PTO but no working schedule)
      exceptionsData?.filter(e => e.is_off).forEach(ptoException => {
        if (!scheduleByDateAndOfficer[ptoException.date]) {
          scheduleByDateAndOfficer[ptoException.date] = {};
        }

        // Only add if officer doesn't already have a schedule entry
        if (!scheduleByDateAndOfficer[ptoException.date][ptoException.officer_id]) {
          scheduleByDateAndOfficer[ptoException.date][ptoException.officer_id] = {
            officerId: ptoException.officer_id,
            officerName: ptoException.profiles?.full_name || "Unknown",
            badgeNumber: ptoException.profiles?.badge_number,
            rank: ptoException.profiles?.rank,
            date: ptoException.date,
            dayOfWeek: parseISO(ptoException.date).getDay(),
            shiftInfo: {
              type: "Off",
              time: "",
              position: "",
              scheduleId: ptoException.id,
              scheduleType: "exception" as const,
              shift: ptoException.shift_types,
              isOff: true,
              reason: ptoException.reason,
              hasPTO: true,
              ptoData: {
                id: ptoException.id,
                ptoType: ptoException.reason,
                startTime: ptoException.custom_start_time || ptoException.shift_types?.start_time || '00:00',
                endTime: ptoException.custom_end_time || ptoException.shift_types?.end_time || '23:59',
                isFullShift: !ptoException.custom_start_time && !ptoException.custom_end_time,
                shiftTypeId: ptoException.shift_type_id
              }
            }
          };
        }
      });

      // Convert to array format for rendering
      const dailySchedules = dates.map(date => {
        const officers = Object.values(scheduleByDateAndOfficer[date] || {});
        return {
          date,
          dayOfWeek: parseISO(date).getDay(),
          officers: officers.sort((a, b) => a.officerName.localeCompare(b.officerName)),
          isCurrentMonth: activeView === "monthly" ? isSameMonth(parseISO(date), currentMonth) : true
        };
      });

      return { 
        dailySchedules, 
        dates,
        recurring: recurringData,
        exceptions: exceptionsData,
        startDate: format(startDate, "yyyy-MM-dd"),
        endDate: format(endDate, "yyyy-MM-dd")
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
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
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
          // Force refresh the schedule data
          queryClient.invalidateQueries({ 
            queryKey: ["schedule", currentWeekStart.toISOString(), currentMonth.toISOString(), activeView, selectedShiftId] 
          });
          setEditingSchedule(null);
        }
      }
    );
  };

  const handleEditClick = (shiftInfo: any, officerId: string) => {
    const scheduleKey = `${shiftInfo.scheduleId}-${shiftInfo.scheduleType}-${officerId}`;
    setEditingSchedule(scheduleKey);
  };

  const handleAssignPTO = (schedule: any, date: string, officerId: string, officerName: string) => {
    setSelectedSchedule({
      scheduleId: schedule.scheduleId,
      type: schedule.scheduleType,
      date: date,
      shift: schedule.shift,
      officerId: officerId,
      officerName: officerName,
      // Pass existing PTO data if available
      ...(schedule.hasPTO && schedule.ptoData ? { existingPTO: schedule.ptoData } : {})
    });
    setPtoDialogOpen(true);
  };

  const handleRemovePTO = async (schedule: any, date: string, officerId: string) => {
    if (!schedule.hasPTO || !schedule.ptoData) return;

    try {
      console.log("🔄 Attempting to remove PTO:", schedule.ptoData);
      
      let shiftTypeId = schedule.shift?.id || schedule.ptoData.shiftTypeId;
      
      if (!shiftTypeId) {
        console.log("🔍 No direct shift ID found, inferring from officer's schedule...");
        
        const { data: officerSchedule, error } = await supabase
          .from("schedule_exceptions")
          .select("shift_type_id")
          .eq("officer_id", officerId)
          .eq("date", date)
          .eq("is_off", false)
          .single();

        if (!error && officerSchedule?.shift_type_id) {
          shiftTypeId = officerSchedule.shift_type_id;
        } else {
          const dayOfWeek = parseISO(date).getDay();
          const { data: recurringSchedule, error: recurringError } = await supabase
            .from("recurring_schedules")
            .select("shift_type_id")
            .eq("officer_id", officerId)
            .eq("day_of_week", dayOfWeek)
            .is("end_date", null)
            .single();

          if (!recurringError && recurringSchedule?.shift_type_id) {
            shiftTypeId = recurringSchedule.shift_type_id;
          }
        }
      }

      if (!shiftTypeId) {
        console.error("No shift_type_id found after all attempts for PTO:", schedule.ptoData.id);
        toast.error(`Cannot remove PTO: Unable to determine shift. Please contact support.`);
        return;
      }

      const ptoData = {
        id: schedule.ptoData.id,
        officerId: officerId,
        date: date,
        shiftTypeId: shiftTypeId,
        ptoType: schedule.ptoData.ptoType,
        startTime: schedule.ptoData.startTime,
        endTime: schedule.ptoData.endTime
      };

      console.log("✅ Removing PTO with final data:", ptoData);
      removePTOMutation.mutate(ptoData);
      
    } catch (error) {
      console.error("Error in handleRemovePTO:", error);
      toast.error("Unexpected error while removing PTO");
    }
  };

  // Function to refresh the schedule data
  const refreshSchedule = () => {
    queryClient.invalidateQueries({ 
      queryKey: ["schedule", currentWeekStart.toISOString(), currentMonth.toISOString(), activeView, selectedShiftId] 
    });
  };

  const isLoading = schedulesLoading || shiftsLoading;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Schedule
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
            Schedule
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

  const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekEnd = addDays(currentWeekStart, 6);
  const isCurrentWeek = startOfWeek(new Date(), { weekStartsOn: 0 }).getTime() === currentWeekStart.getTime();
  const isCurrentMonth = isSameMonth(currentMonth, new Date());

  // For monthly view - get all days in month
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  
  // Get days from previous and next month to fill the calendar grid
  const startDay = monthStart.getDay(); // 0 = Sunday
  const endDay = monthEnd.getDay(); // 0 = Sunday
  
  const previousMonthDays = Array.from({ length: startDay }, (_, i) => 
    addDays(monthStart, -startDay + i)
  );
  
  const nextMonthDays = Array.from({ length: 6 - endDay }, (_, i) => 
    addDays(monthEnd, i + 1)
  );

  const allCalendarDays = [...previousMonthDays, ...monthDays, ...nextMonthDays];

  // Render weekly schedule view - UPDATED to show multiple officers per day
  const renderWeeklyView = () => (
    <div className="space-y-4">
      {schedules?.dailySchedules?.map(({ date, dayOfWeek, officers }) => (
        <div key={date} className="border rounded-lg overflow-hidden">
          <div className="bg-muted/50 p-3 border-b">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{daysOfWeek[dayOfWeek]}</p>
                <p className="text-sm text-muted-foreground">{format(parseISO(date), "MMM d")}</p>
              </div>
              <Badge variant="outline">
                {officers.length} {officers.length === 1 ? 'officer' : 'officers'}
              </Badge>
            </div>
          </div>
          
          <div className="p-3 space-y-2">
            {officers.length === 0 ? (
              <p className="text-sm text-muted-foreground italic text-center py-4">No officers scheduled</p>
            ) : (
              officers.map(({ officerId, officerName, badgeNumber, rank, shiftInfo }) => (
                <div
                  key={`${officerId}-${date}`}
                  className="flex items-center justify-between p-3 rounded-md bg-card border"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{officerName}</p>
                    <p className="text-sm text-muted-foreground">
                      {rank || 'Officer'} • Badge #{badgeNumber}
                    </p>
                  </div>
                  
                  {shiftInfo ? (
                    <div className="flex items-center gap-4">
                      {editingSchedule === `${shiftInfo.scheduleId}-${shiftInfo.scheduleType}-${officerId}` ? (
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
                                  onClick={() => handleEditClick(shiftInfo, officerId)}
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
                                    onClick={() => handleAssignPTO(shiftInfo, date, officerId, officerName)}
                                    title="Edit PTO"
                                  >
                                    <Clock className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleRemovePTO(shiftInfo, date, officerId)}
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
                                  onClick={() => handleAssignPTO(shiftInfo, date, officerId, officerName)}
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
                    <p className="text-sm text-muted-foreground">No shift scheduled</p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );

  // Render monthly schedule view - UPDATED to show multiple officers per day
  const renderMonthlyView = () => (
    <div className="space-y-4">
      {/* Calendar header */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {daysOfWeek.map(day => (
          <div key={day} className="text-center font-medium text-sm py-2">
            {day}
          </div>
        ))}
      </div>
      
      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {allCalendarDays.map((day, index) => {
          const dateStr = format(day, "yyyy-MM-dd");
          const daySchedule = schedules?.dailySchedules?.find(s => s.date === dateStr);
          const isCurrentMonthDay = isSameMonth(day, currentMonth);
          const isToday = isSameDay(day, new Date());
          
          return (
            <div
              key={day.toISOString()}
              className={`
                min-h-24 p-2 border rounded-lg text-sm
                ${isCurrentMonthDay ? 'bg-card' : 'bg-muted/30 text-muted-foreground'}
                ${isToday ? 'border-primary ring-1 ring-primary' : 'border-border'}
                hover:bg-accent/50 transition-colors
              `}
            >
              <div className="flex justify-between items-start mb-1">
                <span className={`
                  text-xs font-medium
                  ${isToday ? 'bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center' : ''}
                `}>
                  {format(day, "d")}
                </span>
                {daySchedule && daySchedule.officers.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {daySchedule.officers.length}
                  </Badge>
                )}
              </div>
              
              {daySchedule?.officers.slice(0, 3).map(({ officerId, officerName, shiftInfo }) => (
                <div key={officerId} className="text-xs mb-1 truncate">
                  <div className="font-medium truncate">{officerName.split(' ')[0]}</div>
                  <div className="text-muted-foreground truncate">{shiftInfo?.type}</div>
                  {shiftInfo?.position && (
                    <Badge variant="secondary" className="text-xs truncate">
                      {shiftInfo.position}
                    </Badge>
                  )}
                </div>
              ))}
              
              {daySchedule?.officers.length > 3 && (
                <div className="text-xs text-muted-foreground mt-1">
                  +{daySchedule.officers.length - 3} more
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Schedule
            </CardTitle>
            {isAdminOrSupervisor && (
              <div className="flex items-center gap-3">
                {/* Shift Filter Dropdown */}
                <Select value={selectedShiftId} onValueChange={setSelectedShiftId}>
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="Select Shift" />
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

                <Button onClick={() => setDialogOpen(true)} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Schedule
                </Button>
              </div>
            )}
          </div>
          
          {/* Shift filter for non-admin users */}
          {!isAdminOrSupervisor && (
            <div className="flex items-center gap-3">
              <Select value={selectedShiftId} onValueChange={setSelectedShiftId}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Select Shift" />
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
          )}
          
          <Tabs value={activeView} onValueChange={(value) => setActiveView(value as "weekly" | "monthly")}>
            <TabsList className="grid w-full max-w-xs grid-cols-2">
              <TabsTrigger value="weekly" className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4" />
                Weekly
              </TabsTrigger>
              <TabsTrigger value="monthly" className="flex items-center gap-2">
                <Grid className="h-4 w-4" />
                Monthly
              </TabsTrigger>
            </TabsList>
          </Tabs>
          
          {/* Navigation */}
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={activeView === "weekly" ? goToPreviousWeek : goToPreviousMonth}
                title={activeView === "weekly" ? "Previous Week" : "Previous Month"}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              
              <div className="text-center">
                <h3 className="text-lg font-semibold">
                  {activeView === "weekly" 
                    ? `${format(currentWeekStart, "MMM d")} - ${format(weekEnd, "MMM d, yyyy")}`
                    : format(currentMonth, "MMMM yyyy")
                  }
                </h3>
                <p className="text-sm text-muted-foreground">
                  {activeView === "weekly" 
                    ? `Week of ${format(currentWeekStart, "MMMM d, yyyy")}`
                    : `Month of ${format(currentMonth, "MMMM yyyy")}`
                  }
                </p>
              </div>
              
              <Button
                variant="outline"
                size="sm"
                onClick={activeView === "weekly" ? goToNextWeek : goToNextMonth}
                title={activeView === "weekly" ? "Next Week" : "Next Month"}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            
            <Button
              variant={(activeView === "weekly" && isCurrentWeek) || (activeView === "monthly" && isCurrentMonth) ? "outline" : "default"}
              size="sm"
              onClick={activeView === "weekly" ? goToCurrentWeek : goToCurrentMonth}
              disabled={(activeView === "weekly" && isCurrentWeek) || (activeView === "monthly" && isCurrentMonth)}
            >
              Today
            </Button>
          </div>

          {selectedShiftId !== "all" && (
            <p className="text-sm text-muted-foreground mt-2">
              Viewing officers assigned to: {shiftTypes?.find(s => s.id === selectedShiftId)?.name}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {activeView === "weekly" ? renderWeeklyView() : renderMonthlyView()}
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
                // Refresh the schedule when the PTO dialog closes
                if (!open) {
                  refreshSchedule();
                }
              }}
              officer={{
                officerId: selectedSchedule.officerId,
                name: selectedSchedule.officerName,
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
