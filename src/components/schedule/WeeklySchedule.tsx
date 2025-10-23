import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format, startOfWeek, addDays, addWeeks, subWeeks, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, parseISO } from "date-fns";
import { Calendar, Plus, Edit2, Clock, Trash2, ChevronLeft, ChevronRight, Grid, Calendar as CalendarIcon } from "lucide-react";
import { ScheduleManagementDialog } from "./ScheduleManagementDialog";
import { PTOAssignmentDialog } from "./PTOAssignmentDialog";
import { PositionEditor } from "./PositionEditor";
import { usePositionMutation } from "@/hooks/usePositionMutation";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface WeeklyScheduleProps {
  userId: string;
  isAdminOrSupervisor: boolean;
}

export const WeeklySchedule = ({ userId, isAdminOrSupervisor }: WeeklyScheduleProps) => {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [ptoDialogOpen, setPtoDialogOpen] = useState(false);
  const [selectedShiftId, setSelectedShiftId] = useState<string>("");
  
  // Assignment editing state
  const [editingAssignment, setEditingAssignment] = useState<{
    officer: any;
    dateStr: string;
  } | null>(null);
  const [editPosition, setEditPosition] = useState("");
  const [customPosition, setCustomPosition] = useState("");

  
  // Add these states near your existing state declarations
  const [selectedDailyDate, setSelectedDailyDate] = useState<Date>(new Date());
  const [selectedDailyShiftId, setSelectedDailyShiftId] = useState<string>("");
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
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [activeView, setActiveView] = useState<"weekly" | "monthly">("weekly");
  const queryClient = useQueryClient();

  // Predefined positions for grouping
  const predefinedPositions = [
    "Supervisor",
    "District 1",
    "District 2", 
    "District 3",
    "District 4",
    "District 5",
    "District 6",
    "District 7/8",
    "District 9",
    "Other (Custom)",
  ];

// Rank order for supervisors
const rankOrder = {
  'Chief': 1,
  'Deputy Chief': 2,
  'Lieutenant': 3,
  'Sergeant': 4,
  'Officer': 5
};


  

  // Add mutation for removing extra shifts (same as DailyScheduleView)
  const removeOfficerMutation = useMutation({
    mutationFn: async (officer: any) => {
      if (officer.shiftInfo.scheduleType === "exception") {
        const { error } = await supabase
          .from("schedule_exceptions")
          .delete()
          .eq("id", officer.shiftInfo.scheduleId);

        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Officer removed from schedule");
      queryClient.invalidateQueries({ 
        queryKey: ["schedule", currentWeekStart.toISOString(), currentMonth.toISOString(), activeView, selectedShiftId] 
      });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to remove officer");
    },
  });

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

  // Function to extract last name from full name
  const getLastName = (fullName: string) => {
    return fullName.split(' ').pop() || fullName;
  };

// ADD THE NAVIGATION FUNCTION RIGHT HERE - after rankOrder but before sortSupervisorsByRank
const navigateToDailySchedule = (dateStr: string) => {
  // Parse the date string to a Date object
  const date = parseISO(dateStr);
  
  // Set the date for Daily Schedule
  setSelectedDailyDate(date);
  
  // Set the same shift filter for Daily Schedule
  setSelectedDailyShiftId(selectedShiftId);
  
  // Switch to the Daily Schedule tab
  setActiveView("daily");
  
  console.log("Navigated to Daily Schedule:", {
    date: dateStr,
    shiftId: selectedShiftId,
    shiftName: shiftTypes?.find(s => s.id === selectedShiftId)?.name
  });
  
  toast.success(`Daily Schedule loaded for ${format(date, "MMM d, yyyy")}`);
};

// Function to sort supervisors by rank ONLY (same as daily schedule)
const sortSupervisorsByRank = (supervisors: any[]) => {
  return supervisors.sort((a, b) => {
    const rankA = a.rank || 'Officer';
    const rankB = b.rank || 'Officer';
    return (rankOrder[rankA as keyof typeof rankOrder] || 99) - (rankOrder[rankB as keyof typeof rankOrder] || 99);
  });
};

  // Function to categorize and sort officers (same as daily schedule)
  const categorizeAndSortOfficers = (officers: any[]) => {
    // Sort all officers by last name first
    const sortedByLastName = [...officers].sort((a, b) => 
      getLastName(a.officerName).localeCompare(getLastName(b.officerName))
    );

    // Separate PTO officers (those marked as off) FIRST
    const ptoOfficers = sortedByLastName.filter(o => o.shiftInfo?.isOff);
    
    // Then categorize the non-PTO officers
    const workingOfficers = sortedByLastName.filter(o => !o.shiftInfo?.isOff);

    const supervisors = sortSupervisorsByRank(
      workingOfficers.filter(o => 
        o.shiftInfo?.position?.toLowerCase().includes('supervisor')
      )
    );

    const regularOfficers = workingOfficers.filter(o => 
      !o.shiftInfo?.position?.toLowerCase().includes('supervisor')
    ).sort((a, b) => {
      const aMatch = a.shiftInfo?.position?.match(/district\s*(\d+)/i);
      const bMatch = b.shiftInfo?.position?.match(/district\s*(\d+)/i);
      
      if (aMatch && bMatch) {
        return parseInt(aMatch[1]) - parseInt(bMatch[1]);
      }
      
      return (a.shiftInfo?.position || '').localeCompare(b.shiftInfo?.position || '');
    });

    return {
      supervisors,
      regularOfficers,
      ptoOfficers
    };
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
      if (!selectedShiftId) return { dailySchedules: [], dates: [], allOfficers: [] };

      // Enhanced query to fetch schedule data for ALL officers in selected shift
const { data: schedules, isLoading: schedulesLoading, error, refetch } = useQuery({
  queryKey: ["schedule", currentWeekStart.toISOString(), currentMonth.toISOString(), activeView, selectedShiftId],
  queryFn: async () => {
    if (!selectedShiftId) return { dailySchedules: [], dates: [], allOfficers: [] };

    // Determine date range based on active view - UPDATED FOR MONTHLY VIEW
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
      // Monthly view - INCLUDE PADDING DAYS for complete calendar grid
      const monthStart = startOfMonth(currentMonth);
      const monthEnd = endOfMonth(currentMonth);
      
      // Calculate padding for previous/next months to complete the calendar grid
      const startDay = monthStart.getDay(); // 0 = Sunday
      const endDay = monthEnd.getDay(); // 0 = Sunday
      
      // Include days from previous month to start on Sunday
      startDate = addDays(monthStart, -startDay);
      // Include days from next month to end on Saturday  
      endDate = addDays(monthEnd, 6 - endDay);
      
      const allDays = eachDayOfInterval({ start: startDate, end: endDate });
      dates = allDays.map(day => format(day, "yyyy-MM-dd"));
    }

    // Rest of your query remains the same...
    const recurringQuery = supabase
      .from("recurring_schedules")
      .select(`
        *,
        shift_types(name, start_time, end_time),
        profiles!inner(id, full_name, badge_number, rank)
      `)
      .eq("shift_type_id", selectedShiftId)
      .lte("start_date", format(endDate, "yyyy-MM-dd"))
      .or(`end_date.is.null,end_date.gte.${format(startDate, "yyyy-MM-dd")}`);

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
        .eq("shift_type_id", selectedShiftId)
        .in("date", dates);

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

      // Convert to array format for rendering with categorized officers
      const dailySchedules = dates.map(date => {
        const officers = Object.values(scheduleByDateAndOfficer[date] || {});
        const categorized = categorizeAndSortOfficers(officers);
        
        // Calculate staffing counts
        const supervisorCount = categorized.supervisors.length;
        const officerCount = categorized.regularOfficers.length;
        const totalWorking = supervisorCount + officerCount;

        return {
          date,
          dayOfWeek: parseISO(date).getDay(),
          officers: officers,
          categorizedOfficers: categorized,
          staffing: {
            supervisors: supervisorCount,
            officers: officerCount,
            total: totalWorking
          },
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
    
  // Assignment editing handler
  const handleEditAssignment = (officer: any, dateStr: string) => {
    setEditingAssignment({ officer, dateStr });
    
    // Pre-fill the current position for editing
    const currentPosition = officer.shiftInfo?.position;
    const isCustomPosition = currentPosition && !predefinedPositions.includes(currentPosition);
    
    if (isCustomPosition) {
      setEditPosition("Other (Custom)");
      setCustomPosition(currentPosition);
    } else {
      setEditPosition(currentPosition || "");
      setCustomPosition("");
    }
  };

  const handleSaveAssignment = () => {
    if (!editingAssignment) return;

    const { officer, dateStr } = editingAssignment;
    const finalPosition = editPosition === "Other (Custom)" ? customPosition : editPosition;
    
    if (!finalPosition) {
      toast.error("Please select or enter a position");
      return;
    }

    updatePositionMutation.mutate({
      scheduleId: officer.shiftInfo.scheduleId,
      type: officer.shiftInfo.scheduleType,
      positionName: finalPosition,
      date: dateStr,
      officerId: officer.officerId,
      shiftTypeId: selectedShiftId,
      currentPosition: officer.shiftInfo.position
    }, {
      onSuccess: () => {
        // Refresh the schedule data immediately after successful update
        queryClient.invalidateQueries({ 
          queryKey: ["schedule", currentWeekStart.toISOString(), currentMonth.toISOString(), activeView, selectedShiftId] 
        });
        setEditingAssignment(null);
        setEditPosition("");
        setCustomPosition("");
      }
    });
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

  // Get display name for officer based on current setting
  const getOfficerDisplayName = (officer: any) => {
    return getLastName(officer.officerName);
  };

  // Updated Schedule Cell Component - Proper PTO display like DailyScheduleView
const ScheduleCell = ({ officer, dateStr, isAdminOrSupervisor, onAssignPTO, onRemovePTO, onEditAssignment, officerId, officerName }: any) => {
  // Check if this officer has any schedule data for this date
  const hasSchedule = !!officer;
  const isOff = officer?.shiftInfo?.isOff;
  const hasPTO = officer?.shiftInfo?.hasPTO;
  const position = officer?.shiftInfo?.position;
  const ptoData = officer?.shiftInfo?.ptoData;
  
  // PROPER LOGIC: Extra shift = schedule exception AND not their regular recurring day
  const isException = officer?.shiftInfo?.scheduleType === "exception";
  const isRegularDay = officer?.isRegularRecurringDay;
  const isExtraShift = isException && !isOff && !hasPTO && !isRegularDay;

  // Check if this is a special assignment
  const isSpecialAssignment = position && (
    position.toLowerCase().includes('other') ||
    (position && !predefinedPositions.includes(position))
  );

  // PTO Logic - Same as DailyScheduleView
  const isFullDayPTO = hasPTO && ptoData?.isFullShift;
  const isPartialPTO = hasPTO && !ptoData?.isFullShift;

  // If no officer data at all, this is an unscheduled day (dark gray)
  if (!hasSchedule) {
    return (
      <div className="p-2 border-r bg-gray-300 dark:bg-gray-600 min-h-10 relative">
        {/* Dark gray for unscheduled days */}
      </div>
    );
  }

  return (
    <div className={`
      p-2 border-r min-h-10 relative group
      ${isOff ? 'bg-muted/50' : ''}
      ${isFullDayPTO ? 'bg-green-50 border-green-200' : ''}
      ${isPartialPTO ? 'bg-white' : ''}
      ${!isOff && !hasPTO ? 'bg-white' : ''}
    `}>
      {isOff ? (
        <div className="text-center text-muted-foreground font-medium">DD</div>
      ) : hasPTO ? (
        <div className="text-center">
          {/* PTO Badge - Same styling as DailyScheduleView */}
          <Badge className={`text-xs ${
            isFullDayPTO 
              ? 'bg-green-100 text-green-800 hover:bg-green-200 border-green-200' 
              : 'bg-green-100 text-green-800 hover:bg-green-200 border-green-200'
          }`}>
            {ptoData?.ptoType || 'PTO'}
          </Badge>
          
          {/* Show position for partial PTO (like DailyScheduleView) */}
          {isPartialPTO && position && (
            <div className="text-xs text-muted-foreground mt-1 truncate">
              {position}
            </div>
          )}
          
          {/* Show "Partial Day" indicator for partial PTO */}
          {isPartialPTO && (
            <div className="text-xs text-green-600 font-medium mt-1">
              Partial Day
            </div>
          )}
        </div>
      ) : (
        <div className="text-center">
          {/* Show "Extra Shift" for true extra days */}
          {isExtraShift && (
            <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200 mb-1">
              Extra Shift
            </Badge>
          )}
          {/* Show "Special Assignment" badge */}
          {isSpecialAssignment && !isExtraShift && (
            <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200 mb-1">
              Special
            </Badge>
          )}
          {position && (
            <div className="text-sm font-medium truncate">
              {position}
            </div>
          )}
        </div>
      )}

      {/* Action buttons for admin/supervisor */}
      {isAdminOrSupervisor && officer.shiftInfo && (
        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
          {/* PENCIL ICON - Edit Assignment (like DailyScheduleView) */}
          {!isOff && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation();
                onEditAssignment(officer, dateStr);
              }}
              title="Edit Assignment"
            >
              <Edit2 className="h-3 w-3" />
            </Button>
          )}
          
          {/* DELETE BUTTON - Only show for extra shifts (exception officers) */}
          {isExtraShift && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-red-600 hover:text-red-800 hover:bg-red-100"
              onClick={(e) => {
                e.stopPropagation();
                removeOfficerMutation.mutate(officer);
              }}
              disabled={removeOfficerMutation.isPending}
              title="Remove Extra Shift"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
          
          {/* CLOCK ICON - PTO Management (like DailyScheduleView) */}
          {!isOff && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation();
                onAssignPTO(officer.shiftInfo, dateStr, officer.officerId, officer.officerName);
              }}
              title={hasPTO ? "Edit PTO" : "Assign PTO"}
            >
              <Clock className="h-3 w-3" />
            </Button>
          )}
          {/* TRASH ICON - Remove PTO (like DailyScheduleView) */}
          {hasPTO && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onRemovePTO(officer.shiftInfo, dateStr, officer.officerId);
              }}
              disabled={removePTOMutation.isPending}
              title="Remove PTO"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

// NEW: Excel-style weekly view with table layout
const renderExcelStyleWeeklyView = () => {
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(currentWeekStart, i);
    return {
      date,
      dateStr: format(date, "yyyy-MM-dd"),
      dayName: format(date, "EEE").toUpperCase(),
      formattedDate: format(date, "MMM d"),
      isToday: isSameDay(date, new Date())
    };
  });

  // Get all unique officers across the week for consistent rows
  const allOfficers = new Map();

  // First, get all recurring schedules to know each officer's normal pattern
  const recurringSchedulesByOfficer = new Map();
  schedules?.recurring?.forEach(recurring => {
    if (!recurringSchedulesByOfficer.has(recurring.officer_id)) {
      recurringSchedulesByOfficer.set(recurring.officer_id, new Set());
    }
    recurringSchedulesByOfficer.get(recurring.officer_id).add(recurring.day_of_week);
  });

  schedules?.dailySchedules?.forEach(day => {
    day.officers.forEach((officer: any) => {
      if (!allOfficers.has(officer.officerId)) {
        allOfficers.set(officer.officerId, {
          ...officer,
          recurringDays: recurringSchedulesByOfficer.get(officer.officerId) || new Set(),
          weeklySchedule: {} as Record<string, any>
        });
      }
      
      // Store the day schedule with proper recurring flag
      const daySchedule = {
        ...officer,
        isRegularRecurringDay: recurringSchedulesByOfficer.get(officer.officerId)?.has(day.dayOfWeek) || false
      };
      
      allOfficers.get(officer.officerId).weeklySchedule[day.date] = daySchedule;
    });
  });

  // UPDATED: Categorize officers based on their MOST COMMON role for the week
  // This prevents a single non-supervisor day from moving them out of supervisor section
  const officerCategories = new Map();
  
  Array.from(allOfficers.values()).forEach(officer => {
    let supervisorDays = 0;
    let regularDays = 0;
    
    // Count supervisor vs regular days for this officer across the week
    weekDays.forEach(({ dateStr }) => {
      const dayOfficer = officer.weeklySchedule[dateStr];
      if (dayOfficer?.shiftInfo?.position?.toLowerCase().includes('supervisor')) {
        supervisorDays++;
      } else if (dayOfficer?.shiftInfo?.position) {
        regularDays++;
      }
    });
    
    // Categorize based on majority role
    if (supervisorDays > regularDays) {
      officerCategories.set(officer.officerId, 'supervisor');
    } else {
      officerCategories.set(officer.officerId, 'officer');
    }
  });

  // UPDATED: Sort supervisors by rank first, then by last name (same as DailyScheduleView)
  const supervisors = Array.from(allOfficers.values())
    .filter(o => officerCategories.get(o.officerId) === 'supervisor')
    .sort((a, b) => {
      // First sort by rank (same as DailyScheduleView)
      const rankA = a.rank || 'Officer';
      const rankB = b.rank || 'Officer';
      const rankComparison = (rankOrder[rankA as keyof typeof rankOrder] || 99) - 
                            (rankOrder[rankB as keyof typeof rankOrder] || 99);
      
      // If same rank, then sort by last name
      if (rankComparison === 0) {
        return getLastName(a.officerName).localeCompare(getLastName(b.officerName));
      }
      
      return rankComparison;
    });

  const officers = Array.from(allOfficers.values())
    .filter(o => officerCategories.get(o.officerId) === 'officer')
    .sort((a, b) => getLastName(a.officerName).localeCompare(getLastName(b.officerName)));

  // Calculate minimum staffing (you might want to make this dynamic)
  const minimumStaffing = {
    MON: 8, TUE: 8, WED: 8, THU: 8, FRI: 9, SAT: 9, SUN: 8
  };

  return (
    <div className="space-y-4">
      {/* Calendar header */}
      <div className="flex justify-between items-center">
        <div className="text-lg font-bold">
          {format(currentWeekStart, "MMM d")} - {format(addDays(currentWeekStart, 6), "MMM d, yyyy")}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={goToPreviousWeek}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToCurrentWeek}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={goToNextWeek}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main schedule table */}
      <div className="border rounded-lg overflow-hidden">
        {/* Table header with staffing badges - Supervisor on top, Officer below */}
        <div className="grid grid-cols-9 bg-muted/50 border-b">
          <div className="p-2 font-semibold border-r">Empl#</div>
          <div className="p-2 font-semibold border-r">SUPERVISORS</div>
          {weekDays.map(({ dateStr, dayName, formattedDate, isToday }) => {
  const daySchedule = schedules?.dailySchedules?.find(s => s.date === dateStr);
  
  // Calculate staffing for this day
  const supervisorCount = daySchedule?.categorizedOfficers?.supervisors.filter(officer => 
    !officer.shiftInfo?.hasPTO
  ).length || 0;
  
  const officerCount = daySchedule?.categorizedOfficers?.regularOfficers.filter(officer => {
    const isSpecialAssignment = officer.shiftInfo?.position && (
      officer.shiftInfo.position.toLowerCase().includes('other') ||
      (officer.shiftInfo.position && !predefinedPositions.includes(officer.shiftInfo.position))
    );
    return !officer.shiftInfo?.hasPTO && !isSpecialAssignment;
  }).length || 0;
  
  const minimumOfficers = minimumStaffing[dayName as keyof typeof minimumStaffing];
  const minimumSupervisors = 1;
  
  const isOfficersUnderstaffed = officerCount < minimumOfficers;
  const isSupervisorsUnderstaffed = supervisorCount < minimumSupervisors;

  return (
    <div key={dateStr} className={`p-2 text-center font-semibold border-r ${isToday ? 'bg-primary/10' : ''}`}>
      {/* Clickable date button */}
      <Button
        variant="ghost"
        size="sm"
        className="h-auto p-0 font-semibold hover:bg-transparent hover:underline"
        onClick={() => navigateToDailySchedule(dateStr)}
      >
        <div>{dayName}</div>
        <div className="text-xs text-muted-foreground mb-1">{formattedDate}</div>
      </Button>
      
      {/* Supervisor Badge - ON TOP */}
      <Badge 
        variant={isSupervisorsUnderstaffed ? "destructive" : "outline"} 
        className="text-xs mb-1"
      >
        {supervisorCount} / {minimumSupervisors} Sup
      </Badge>
      
      {/* Officer Badge - BELOW */}
      <Badge 
        variant={isOfficersUnderstaffed ? "destructive" : "outline"} 
        className="text-xs"
      >
        {officerCount} / {minimumOfficers} Ofc
      </Badge>
    </div>
  );
})}
        </div>

        {/* Supervisors section */}
        <div className="border-b">
          {/* Supervisor count row */}
          <div className="grid grid-cols-9 border-b">
            <div className="p-2 border-r"></div>
            <div className="p-2 border-r text-sm font-medium">COUNT</div>
            {weekDays.map(({ dateStr }) => {
              const daySchedule = schedules?.dailySchedules?.find(s => s.date === dateStr);
              
              // UPDATED: Only count supervisors who are not on PTO
              const supervisorCount = daySchedule?.categorizedOfficers?.supervisors.filter(officer => 
                !officer.shiftInfo?.hasPTO
              ).length || 0;
              
              return (
                <div key={dateStr} className="p-2 text-center border-r text-sm">
                  {supervisorCount}
                </div>
              );
            })}
          </div>

          {/* Individual supervisors - NOW SORTED BY RANK THEN LAST NAME */}
          {supervisors.map((officer) => (
            <div key={officer.officerId} className="grid grid-cols-9 border-b hover:bg-muted/30">
              <div className="p-2 border-r text-sm font-mono">{officer.badgeNumber}</div>
              <div className="p-2 border-r font-medium">
                {getOfficerDisplayName(officer)}
                <div className="text-xs text-muted-foreground">{officer.rank || 'Officer'}</div>
              </div>
              {weekDays.map(({ dateStr }) => {
                const dayOfficer = officer.weeklySchedule[dateStr];
                return (
                  <ScheduleCell
                    key={dateStr}
                    officer={dayOfficer}
                    dateStr={dateStr}
                    officerId={officer.officerId}
                    officerName={officer.officerName}
                    isAdminOrSupervisor={isAdminOrSupervisor}
                    onAssignPTO={handleAssignPTO}
                    onRemovePTO={handleRemovePTO}
                    onEditAssignment={handleEditAssignment}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* Officers section */}
        <div>
          {/* Individual officers - NO header rows above them */}
          {officers.map((officer) => (
            <div key={officer.officerId} className="grid grid-cols-9 border-b hover:bg-muted/30">
              <div className="p-2 border-r text-sm font-mono">{officer.badgeNumber}</div>
              <div className="p-2 border-r font-medium">{getOfficerDisplayName(officer)}</div>
              {weekDays.map(({ dateStr }) => {
                const dayOfficer = officer.weeklySchedule[dateStr];
                return (
                  <ScheduleCell
                    key={dateStr}
                    officer={dayOfficer}
                    dateStr={dateStr}
                    officerId={officer.officerId}
                    officerName={officer.officerName}
                    isAdminOrSupervisor={isAdminOrSupervisor}
                    onAssignPTO={handleAssignPTO}
                    onRemovePTO={handleRemovePTO}
                    onEditAssignment={handleEditAssignment}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

  // Fixed Monthly View - UPDATED VERSION
const renderMonthlyView = () => {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  
  // Get days from previous and next month to fill the calendar grid
  const startDay = monthStart.getDay();
  const endDay = monthEnd.getDay();
  
  const previousMonthDays = Array.from({ length: startDay }, (_, i) => 
    addDays(monthStart, -startDay + i)
  );
  
  const nextMonthDays = Array.from({ length: 6 - endDay }, (_, i) => 
    addDays(monthEnd, i + 1)
  );

  const allCalendarDays = [...previousMonthDays, ...monthDays, ...nextMonthDays];

  // Calculate minimum staffing (same as weekly view)
  const minimumStaffing = {
    SUN: 8, MON: 8, TUE: 8, WED: 8, THU: 8, FRI: 9, SAT: 9
  };

  return (
    <div className="space-y-4">
      {/* Calendar header */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
          <div key={day} className="text-center font-medium text-sm py-2 bg-muted/50 rounded">
            {day}
          </div>
        ))}
      </div>
      
      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {allCalendarDays.map((day, index) => {
          const dateStr = format(day, "yyyy-MM-dd");
          const dayName = format(day, "EEE").toUpperCase() as keyof typeof minimumStaffing;
          const daySchedule = schedules?.dailySchedules?.find(s => s.date === dateStr);
          const isCurrentMonthDay = isSameMonth(day, currentMonth);
          const isToday = isSameDay(day, new Date());
          
          // NEW: Filter officers to only show those with full-day PTO
          const ptoOfficers = daySchedule?.officers.filter((officer: any) => 
            officer.shiftInfo?.hasPTO && officer.shiftInfo?.ptoData?.isFullShift
          ) || [];
          
          // NEW: Calculate staffing levels for understaffed flags
          const supervisorCount = daySchedule?.categorizedOfficers?.supervisors.filter((officer: any) => 
            !officer.shiftInfo?.hasPTO
          ).length || 0;
          
          const officerCount = daySchedule?.categorizedOfficers?.regularOfficers.filter((officer: any) => {
            const isSpecialAssignment = officer.shiftInfo?.position && (
              officer.shiftInfo.position.toLowerCase().includes('other') ||
              (officer.shiftInfo.position && !predefinedPositions.includes(officer.shiftInfo.position))
            );
            return !officer.shiftInfo?.hasPTO && !isSpecialAssignment;
          }).length || 0;
          
          const minimumOfficers = minimumStaffing[dayName];
          const minimumSupervisors = 1;
          
          const isOfficersUnderstaffed = officerCount < minimumOfficers;
          const isSupervisorsUnderstaffed = supervisorCount < minimumSupervisors;
          const isUnderstaffed = isOfficersUnderstaffed || isSupervisorsUnderstaffed;

          return (
            <div
              key={day.toISOString()}
              className={`
                min-h-32 p-2 border rounded-lg text-sm flex flex-col
                ${isCurrentMonthDay ? 'bg-card' : 'bg-muted/20 text-muted-foreground'}
                ${isToday ? 'border-primary ring-2 ring-primary' : 'border-border'}
                hover:bg-accent/50 transition-colors
                ${isUnderstaffed ? 'bg-red-50 border-red-200' : ''}
              `}
            >
              {/* Date header with clickable button */}
              <div className="flex justify-between items-start mb-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`
                    h-6 w-6 p-0 text-xs font-medium hover:bg-primary hover:text-primary-foreground
                    ${isToday ? 'bg-primary text-primary-foreground' : ''}
                  `}
                  onClick={() => navigateToDailySchedule(dateStr)}
                  title={`View daily schedule for ${format(day, "MMM d, yyyy")}`}
                >
                  {format(day, "d")}
                </Button>
                
                {/* Staffing badges */}
                <div className="flex flex-col gap-1">
                  {isUnderstaffed && (
                    <Badge variant="destructive" className="text-xs h-4">
                      Understaffed
                    </Badge>
                  )}
                  {ptoOfficers.length > 0 && (
                    <Badge variant="outline" className="text-xs h-4 bg-green-50 text-green-800 border-green-200">
                      {ptoOfficers.length} PTO
                    </Badge>
                  )}
                </div>
              </div>
              
              {/* PTO Officers List */}
              <div className="space-y-1 flex-1 overflow-y-auto">
                {ptoOfficers.length > 0 ? (
                  ptoOfficers.map((officer: any) => (
                    <div 
                      key={officer.officerId} 
                      className="text-xs p-1 bg-green-50 rounded border border-green-200"
                    >
                      <div className="font-medium truncate text-green-800">
                        {getLastName(officer.officerName)}
                      </div>
                      <div className="text-green-600 truncate text-[10px]">
                        {officer.shiftInfo?.ptoData?.ptoType || 'PTO'}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-muted-foreground text-center py-2">
                    No full-day PTO
                  </div>
                )}
              </div>
              
              {/* Understaffing details */}
              {isUnderstaffed && (
                <div className="mt-1 text-[10px] text-red-600 space-y-0.5">
                  {isSupervisorsUnderstaffed && (
                    <div>Sup: {supervisorCount}/{minimumSupervisors}</div>
                  )}
                  {isOfficersUnderstaffed && (
                    <div>Ofc: {officerCount}/{minimumOfficers}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

  const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekEnd = addDays(currentWeekStart, 6);
  const isCurrentWeek = startOfWeek(new Date(), { weekStartsOn: 0 }).getTime() === currentWeekStart.getTime();
  const isCurrentMonth = isSameMonth(currentMonth, new Date());

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

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Schedule - {shiftTypes?.find(s => s.id === selectedShiftId)?.name || "Select Shift"}
            </CardTitle>
            {isAdminOrSupervisor && (
              <div className="flex items-center gap-3">
                {/* Shift Filter Dropdown - REQUIRED */}
                <Select value={selectedShiftId} onValueChange={setSelectedShiftId}>
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="Select Shift" />
                  </SelectTrigger>
                  <SelectContent>
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
          {!selectedShiftId ? (
            <div className="text-center py-8 text-muted-foreground">
              Please select a shift to view the schedule
            </div>
          ) : activeView === "weekly" ? renderExcelStyleWeeklyView() : renderMonthlyView()}
        </CardContent>
      </Card>

      {/* Assignment Editing Dialog */}
      <Dialog open={!!editingAssignment} onOpenChange={(open) => !open && setEditingAssignment(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Assignment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="position-select">Position</Label>
              <Select value={editPosition} onValueChange={setEditPosition}>
                <SelectTrigger id="position-select">
                  <SelectValue placeholder="Select position" />
                </SelectTrigger>
                <SelectContent>
                  {predefinedPositions.map((pos) => (
                    <SelectItem key={pos} value={pos}>
                      {pos}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editPosition === "Other (Custom)" && (
                <Input
                  placeholder="Custom position"
                  value={customPosition}
                  onChange={(e) => setCustomPosition(e.target.value)}
                  className="mt-2"
                />
              )}
            </div>
            <Button
              className="w-full"
              onClick={handleSaveAssignment}
              disabled={updatePositionMutation.isPending}
            >
              {updatePositionMutation.isPending ? "Saving..." : "Save Assignment"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
