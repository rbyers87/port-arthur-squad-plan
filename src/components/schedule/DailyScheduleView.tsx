import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, AlertTriangle, CheckCircle, Edit2, Save, X, Clock, Trash2, UserPlus } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { PTOAssignmentDialog } from "./PTOAssignmentDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface DailyScheduleViewProps {
  selectedDate: Date;
  filterShiftId?: string;
  isAdminOrSupervisor?: boolean;
  userId?: string;
}

export const DailyScheduleView = ({ selectedDate, filterShiftId = "all", isAdminOrSupervisor = false }: DailyScheduleViewProps) => {
  const queryClient = useQueryClient();
  const [editingSchedule, setEditingSchedule] = useState<string | null>(null);
  const [editPosition, setEditPosition] = useState("");
  const [customPosition, setCustomPosition] = useState("");
  const [ptoDialogOpen, setPtoDialogOpen] = useState(false);
  const [selectedOfficer, setSelectedOfficer] = useState<{
    officerId: string;
    name: string;
    scheduleId: string;
    type: "recurring" | "exception";
    existingPTO?: {
      id: string;
      ptoType: string;
      startTime: string;
      endTime: string;
      isFullShift: boolean;
    };
  } | null>(null);
  const [selectedShift, setSelectedShift] = useState<{
    id: string;
    name: string;
    start_time: string;
    end_time: string;
  } | null>(null);
  const [addOfficerDialogOpen, setAddOfficerDialogOpen] = useState(false);
  const [selectedShiftForAdd, setSelectedShiftForAdd] = useState<any>(null);

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const dayOfWeek = selectedDate.getDay();

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

  const { data: scheduleData, isLoading } = useQuery({
    queryKey: ["daily-schedule", dateStr],
    queryFn: async () => {
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

      // Get recurring schedules for this day of week
      const { data: recurringData, error: recurringError } = await supabase
        .from("recurring_schedules")
        .select(`
          *,
          profiles(id, full_name, badge_number),
          shift_types(id, name, start_time, end_time)
        `)
        .eq("day_of_week", dayOfWeek)
        .is("end_date", null); // Only get ongoing schedules

      if (recurringError) throw recurringError;

      // Get schedule exceptions for this specific date
      const { data: exceptionsData, error: exceptionsError } = await supabase
        .from("schedule_exceptions")
        .select(`
          *,
          profiles(id, full_name, badge_number),
          shift_types(id, name, start_time, end_time)
        `)
        .eq("date", dateStr);

      if (exceptionsError) throw exceptionsError;

      // Separate PTO exceptions from regular exceptions
      const ptoExceptions = exceptionsData?.filter(e => e.is_off) || [];
      const workingExceptions = exceptionsData?.filter(e => !e.is_off) || [];

      // Build schedule by shift
      const scheduleByShift = shiftTypes?.map((shift) => {
        // Get minimum staffing for this shift
        const minStaff = minimumStaffing?.find(m => m.shift_type_id === shift.id);

        // Get recurring officers for this shift
        const recurringOfficers = recurringData
          ?.filter(r => r.shift_types?.id === shift.id)
          .map(r => {
            // Check if this officer has an exception for today
            const workingException = workingExceptions?.find(e => 
              e.officer_id === r.officer_id && e.shift_types?.id === shift.id
            );

            const ptoException = ptoExceptions?.find(e => 
              e.officer_id === r.officer_id && e.shift_types?.id === shift.id
            );

            return {
              scheduleId: workingException ? workingException.id : r.id,
              officerId: r.officer_id,
              name: r.profiles?.full_name || "Unknown",
              badge: r.profiles?.badge_number,
              position: workingException ? workingException.position_name : r.position_name,
              type: workingException ? "exception" as const : "recurring" as const,
              originalScheduleId: r.id,
              customTime: workingException?.custom_start_time && workingException?.custom_end_time
                ? `${workingException.custom_start_time} - ${workingException.custom_end_time}`
                : undefined,
              hasPTO: !!ptoException,
              ptoData: ptoException ? {
                id: ptoException.id,
                ptoType: ptoException.reason,
                startTime: ptoException.custom_start_time || shift.start_time,
                endTime: ptoException.custom_end_time || shift.end_time,
                isFullShift: !ptoException.custom_start_time && !ptoException.custom_end_time
              } : undefined,
              shift: shift
            };
          }) || [];

        // Get additional officers from working exceptions (not in recurring schedule)
        const additionalOfficers = workingExceptions
          ?.filter(e => 
            e.shift_types?.id === shift.id &&
            !recurringData?.some(r => r.officer_id === e.officer_id)
          )
          .map(e => ({
            scheduleId: e.id,
            officerId: e.officer_id,
            name: e.profiles?.full_name || "Unknown",
            badge: e.profiles?.badge_number,
            position: e.position_name,
            type: "exception" as const,
            originalScheduleId: null,
            customTime: e.custom_start_time && e.custom_end_time
              ? `${e.custom_start_time} - ${e.custom_end_time}`
              : undefined,
            hasPTO: false,
            ptoData: undefined,
            shift: shift
          })) || [];

        // Combine all officers
        const allOfficers = [...recurringOfficers, ...additionalOfficers];

        // Get PTO records for this shift (officers who are completely off)
        const shiftPTORecords = ptoExceptions?.filter(e => 
          e.shift_types?.id === shift.id
        ).map(e => ({
          id: e.id,
          officerId: e.officer_id,
          name: e.profiles?.full_name || "Unknown",
          badge: e.profiles?.badge_number,
          ptoType: e.reason || "PTO",
          startTime: e.custom_start_time || shift.start_time,
          endTime: e.custom_end_time || shift.end_time,
          isFullShift: !e.custom_start_time && !e.custom_end_time,
          shiftTypeId: shift.id
        })) || [];

        // Separate supervisors and officers based on position
        const supervisors = allOfficers.filter(o => 
          o.position?.toLowerCase().includes('supervisor')
        ).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        // Special assignment officers (those with "Other (Custom)" positions or custom text)
        const specialAssignmentOfficers = allOfficers.filter(o => {
          const position = o.position?.toLowerCase() || '';
          return position.includes('other') || 
                 (o.position && !predefinedPositions.includes(o.position));
        }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        // Regular officers (exclude supervisors and special assignments)
        const regularOfficers = allOfficers.filter(o => 
          !o.position?.toLowerCase().includes('supervisor') && 
          !specialAssignmentOfficers.includes(o)
        ).sort((a, b) => {
          // Sort by district number if applicable
          const aMatch = a.position?.match(/district\s*(\d+)/i);
          const bMatch = b.position?.match(/district\s*(\d+)/i);
          
          if (aMatch && bMatch) {
            return parseInt(aMatch[1]) - parseInt(bMatch[1]);
          }
          
          // Fallback to alphabetical
          return (a.position || '').localeCompare(b.position || '');
        });

        return {
          shift,
          minSupervisors: minStaff?.minimum_supervisors || 1,
          minOfficers: minStaff?.minimum_officers || 0,
          currentSupervisors: supervisors.length,
          currentOfficers: regularOfficers.length,
          supervisors,
          officers: regularOfficers,
          specialAssignmentOfficers,
          ptoRecords: shiftPTORecords,
        };
      });

      // Filter by shift if needed
      const filteredSchedule = filterShiftId === "all" 
        ? scheduleByShift 
        : scheduleByShift?.filter(s => s.shift.id === filterShiftId);

      return filteredSchedule;
    },
  });

  const updatePositionMutation = useMutation({
    mutationFn: async ({ scheduleId, type, positionName, date, officerId, shiftTypeId }: { 
      scheduleId: string; 
      type: "recurring" | "exception";
      positionName: string;
      date?: string;
      officerId?: string;
      shiftTypeId?: string;
    }) => {
      // If it's a recurring schedule and we're making a daily adjustment, create an exception
      if (type === "recurring") {
        const { error } = await supabase
          .from("schedule_exceptions")
          .upsert({
            officer_id: officerId,
            date: dateStr,
            shift_type_id: shiftTypeId,
            is_off: false,
            position_name: positionName,
            custom_start_time: null,
            custom_end_time: null
          }, {
            onConflict: 'officer_id,date,shift_type_id'
          });
        
        if (error) throw error;
      } else {
        // If it's already an exception, just update it
        const { error } = await supabase
          .from("schedule_exceptions")
          .update({ 
            position_name: positionName
          })
          .eq("id", scheduleId);
          
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Position updated");
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
      setEditingSchedule(null);
      setEditPosition("");
      setCustomPosition("");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update position");
    },
  });

  // Add mutation for removing an officer from the daily schedule
  const removeOfficerMutation = useMutation({
    mutationFn: async (officer: any) => {
      if (officer.type === "exception") {
        // Delete the exception
        const { error } = await supabase
          .from("schedule_exceptions")
          .delete()
          .eq("id", officer.scheduleId);

        if (error) throw error;
      }
      // If it's a recurring schedule, we don't delete it - it will still show as base schedule
    },
    onSuccess: () => {
      toast.success("Officer removed from daily schedule");
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to remove officer");
    },
  });

  // Add mutation for adding an officer to the daily schedule
  const addOfficerMutation = useMutation({
    mutationFn: async ({ officerId, shiftId, position }: { officerId: string; shiftId: string; position: string }) => {
      const { error } = await supabase
        .from("schedule_exceptions")
        .upsert({
          officer_id: officerId,
          date: dateStr,
          shift_type_id: shiftId,
          is_off: false,
          position_name: position,
          custom_start_time: null,
          custom_end_time: null
        }, {
          onConflict: 'officer_id,date,shift_type_id'
        });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Officer added to schedule");
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
      setAddOfficerDialogOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to add officer");
    },
  });

  // Add mutation for removing PTO
  const removePTOMutation = useMutation({
    mutationFn: async (ptoRecord: any) => {
      // Calculate hours to restore
      const calculateHours = (start: string, end: string) => {
        const [startHour, startMin] = start.split(":").map(Number);
        const [endHour, endMin] = end.split(":").map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;
        return (endMinutes - startMinutes) / 60;
      };

      const hoursUsed = calculateHours(ptoRecord.startTime, ptoRecord.endTime);

      // Restore PTO balance
      const PTO_TYPES = [
        { value: "vacation", label: "Vacation", column: "vacation_hours" },
        { value: "holiday", label: "Holiday", column: "holiday_hours" },
        { value: "sick", label: "Sick", column: "sick_hours" },
        { value: "comp", label: "Comp", column: "comp_hours" },
      ];

      const ptoColumn = PTO_TYPES.find((t) => t.value === ptoRecord.ptoType)?.column;
      if (ptoColumn) {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", ptoRecord.officerId)
          .single();

        if (profileError) throw profileError;

        const currentBalance = profile[ptoColumn as keyof typeof profile] as number;
        
        const { error: restoreError } = await supabase
          .from("profiles")
          .update({
            [ptoColumn]: currentBalance + hoursUsed,
          })
          .eq("id", ptoRecord.officerId);

        if (restoreError) throw restoreError;
      }

      // Delete the PTO exception
      const { error: deleteError } = await supabase
        .from("schedule_exceptions")
        .delete()
        .eq("id", ptoRecord.id);

      if (deleteError) throw deleteError;

      // Also delete any associated working time exception
      await supabase
        .from("schedule_exceptions")
        .delete()
        .eq("officer_id", ptoRecord.officerId)
        .eq("date", dateStr)
        .eq("shift_type_id", ptoRecord.shiftTypeId)
        .eq("is_off", false);
    },
    onSuccess: () => {
      toast.success("PTO removed and balance restored");
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["weekly-schedule"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to remove PTO");
    },
  });

  const handleSavePosition = (officer: any) => {
    const finalPosition = editPosition === "Other (Custom)" ? customPosition : editPosition;
    if (!finalPosition) {
      toast.error("Please select or enter a position");
      return;
    }

    updatePositionMutation.mutate({ 
      scheduleId: officer.scheduleId, 
      type: officer.type,
      positionName: finalPosition,
      date: dateStr,
      officerId: officer.officerId,
      shiftTypeId: officer.shift.id
    });
  };

  const handleEditClick = (officer: any) => {
    setEditingSchedule(`${officer.scheduleId}-${officer.type}`);
    
    // Check if the officer's current position is a custom position
    const isCustomPosition = officer.position && !predefinedPositions.includes(officer.position);
    
    if (isCustomPosition) {
      // If it's a custom position, set to "Other (Custom)" and populate the custom field
      setEditPosition("Other (Custom)");
      setCustomPosition(officer.position);
    } else {
      // If it's a predefined position, use it directly
      setEditPosition(officer.position || "");
      setCustomPosition("");
    }
  };

  const handleEditPTO = (ptoRecord: any) => {
    setSelectedOfficer({
      officerId: ptoRecord.officerId,
      name: ptoRecord.name,
      scheduleId: ptoRecord.id,
      type: "exception" as const,
      existingPTO: {
        id: ptoRecord.id,
        ptoType: ptoRecord.ptoType,
        startTime: ptoRecord.startTime,
        endTime: ptoRecord.endTime,
        isFullShift: ptoRecord.isFullShift
      }
    });
    setSelectedShift({
      id: ptoRecord.shiftTypeId,
      name: "Unknown Shift",
      start_time: ptoRecord.startTime,
      end_time: ptoRecord.endTime
    });
    setPtoDialogOpen(true);
  };

  const handleAddOfficer = (shift: any) => {
    setSelectedShiftForAdd(shift);
    setAddOfficerDialogOpen(true);
  };

  // In the DailyScheduleView.tsx, update the officer rendering to remove PTO buttons from regular officers
// and ensure they only show on PTO records in the "Other (PTO)" section

const renderOfficerSection = (title: string, officers: any[], minCount: number, currentCount: number, isUnderstaffed: boolean) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between border-b pb-2">
      <h4 className="font-semibold text-sm">{title}</h4>
      <Badge variant={isUnderstaffed ? "destructive" : "outline"}>
        {currentCount} / {minCount}
      </Badge>
    </div>
    {officers.length === 0 ? (
      <p className="text-sm text-muted-foreground italic">No {title.toLowerCase()} scheduled</p>
    ) : (
      officers.map((officer) => (
        <div
          key={`${officer.scheduleId}-${officer.type}`}
          className="flex items-center justify-between p-3 bg-muted/50 rounded-md"
        >
          <div className="flex-1">
            <p className="font-medium">{officer.name}</p>
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground">Badge #{officer.badge}</p>
              {officer.customTime && (
                <Badge variant="outline" className="text-xs">
                  {officer.customTime}
                </Badge>
              )}
              {officer.type === "recurring" && (
                <Badge variant="secondary" className="text-xs">
                  Recurring
                </Badge>
              )}
            </div>
          </div>

          {editingSchedule === `${officer.scheduleId}-${officer.type}` ? (
            <div className="flex items-center gap-2">
              <div className="space-y-2">
                <Select value={editPosition} onValueChange={setEditPosition}>
                  <SelectTrigger className="w-48">
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
                    placeholder="Enter special assignment"
                    value={customPosition}
                    onChange={(e) => setCustomPosition(e.target.value)}
                    className="w-48"
                  />
                )}
              </div>
              <Button
                size="sm"
                onClick={() => handleSavePosition(officer)}
                disabled={updatePositionMutation.isPending}
              >
                <Save className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditingSchedule(null);
                  setEditPosition("");
                  setCustomPosition("");
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
  <div className="text-right min-w-32">
    <Badge variant="secondary">
      {officer.position || "No Position"}
    </Badge>
  </div>
  
  {/* EDIT POSITION BUTTON - Show for all officers */}
  <Button
    size="sm"
    variant="ghost"
    onClick={() => handleEditClick(officer)}
    title="Edit Position"
  >
    <Edit2 className="h-4 w-4" />
  </Button>
  
  {/* REMOVE BUTTON - Only show for daily exceptions (not base recurring) AND when no PTO */}
  {officer.type === "exception" && !officer.hasPTO && (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => removeOfficerMutation.mutate(officer)}
      disabled={removeOfficerMutation.isPending}
      title="Remove from Daily Schedule"
    >
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  )}
  
  {/* ASSIGN PTO BUTTON - Show for all regularly scheduled officers */}
  <Button
    size="sm"
    variant="ghost"
    onClick={() => {
      setSelectedOfficer({
        officerId: officer.officerId,
        name: officer.name,
        scheduleId: officer.scheduleId,
        type: officer.type,
      });
      setSelectedShift(officer.shift);
      setPtoDialogOpen(true);
    }}
    title="Assign PTO"
  >
    <Clock className="h-4 w-4" />
  </Button>
</div>
          )}
        </div>
      ))
    )}
  </div>
);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Daily Schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-96 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Schedule for {format(selectedDate, "EEEE, MMMM d, yyyy")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {scheduleData?.map((shiftData) => {
          const supervisorsUnderstaffed = shiftData.currentSupervisors < shiftData.minSupervisors;
          const officersUnderstaffed = shiftData.currentOfficers < shiftData.minOfficers;
          const isAnyUnderstaffed = supervisorsUnderstaffed || officersUnderstaffed;
          const isFullyStaffed = !isAnyUnderstaffed;

          return (
            <div key={shiftData.shift.id} className="border rounded-lg p-4 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{shiftData.shift.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {shiftData.shift.start_time} - {shiftData.shift.end_time}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isAnyUnderstaffed && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Understaffed
                    </Badge>
                  )}
                  {isFullyStaffed && (
                    <Badge variant="default" className="gap-1 bg-green-600">
                      <CheckCircle className="h-3 w-3" />
                      Fully Staffed
                    </Badge>
                  )}
                  {isAdminOrSupervisor && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAddOfficer(shiftData.shift)}
                      title="Add Officer"
                    >
                      <UserPlus className="h-4 w-4 mr-1" />
                      Add Officer
                    </Button>
                  )}
                </div>
              </div>

              {renderOfficerSection("Supervisors", shiftData.supervisors, shiftData.minSupervisors, shiftData.currentSupervisors, supervisorsUnderstaffed)}
              {renderOfficerSection("Officers", shiftData.officers, shiftData.minOfficers, shiftData.currentOfficers, officersUnderstaffed)}

             {/* Special Assignment Section */}
{shiftData.specialAssignmentOfficers && shiftData.specialAssignmentOfficers.length > 0 && (
  <div className="space-y-2">
    <div className="flex items-center justify-between border-b pb-2">
      <h4 className="font-semibold text-sm">Special Assignment</h4>
      <Badge variant="outline">{shiftData.specialAssignmentOfficers.length}</Badge>
    </div>
    {shiftData.specialAssignmentOfficers.map((officer) => (
      <div
        key={`${officer.scheduleId}-${officer.type}`}
        className="flex items-center justify-between p-3 bg-blue-50 rounded-md border border-blue-200"
      >
        <div className="flex-1">
          <p className="font-medium">{officer.name}</p>
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">Badge #{officer.badge}</p>
            {officer.customTime && (
              <Badge variant="outline" className="text-xs">
                {officer.customTime}
              </Badge>
            )}
            {officer.type === "recurring" && (
              <Badge variant="secondary" className="text-xs">
                Recurring
              </Badge>
            )}
          </div>
        </div>

        {editingSchedule === `${officer.scheduleId}-${officer.type}` ? (
          <div className="flex items-center gap-2">
            <div className="space-y-2">
              <Select value={editPosition} onValueChange={setEditPosition}>
                <SelectTrigger className="w-48">
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
                  placeholder="Enter special assignment"
                  value={customPosition}
                  onChange={(e) => setCustomPosition(e.target.value)}
                  className="w-48"
                />
              )}
            </div>
            <Button
              size="sm"
              onClick={() => handleSavePosition(officer)}
              disabled={updatePositionMutation.isPending}
            >
              <Save className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditingSchedule(null);
                setEditPosition("");
                setCustomPosition("");
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="text-right">
              <Badge variant="default" className="bg-blue-600 mb-1">
                Special Assignment
              </Badge>
              <p className="text-xs text-muted-foreground max-w-32 truncate">
                {officer.position}
              </p>
            </div>
            
            {/* EDIT POSITION BUTTON */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleEditClick(officer)}
              title="Edit Position"
            >
              <Edit2 className="h-4 w-4" />
            </Button>
            
            {/* REMOVE BUTTON - Only show for daily exceptions (not base recurring) AND when no PTO */}
            {officer.type === "exception" && !officer.hasPTO && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => removeOfficerMutation.mutate(officer)}
                disabled={removeOfficerMutation.isPending}
                title="Remove from Daily Schedule"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
            
            {/* ASSIGN PTO BUTTON */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelectedOfficer({
                  officerId: officer.officerId,
                  name: officer.name,
                  scheduleId: officer.scheduleId,
                  type: officer.type,
                });
                setSelectedShift(officer.shift);
                setPtoDialogOpen(true);
              }}
              title="Assign PTO"
            >
              <Clock className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    ))}
  </div>
)}

              {/* Other (PTO) Section */}
              {shiftData.ptoRecords && shiftData.ptoRecords.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between border-b pb-2">
                    <h4 className="font-semibold text-sm">Other (PTO)</h4>
                    <Badge variant="outline">{shiftData.ptoRecords.length}</Badge>
                  </div>
                  {shiftData.ptoRecords.map((record, idx) => (
                    <div
                      key={`${record.id}-${idx}`}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-md"
                    >
                      <div className="flex-1">
                        <p className="font-medium">{record.name}</p>
                        <p className="text-sm text-muted-foreground">Badge #{record.badge}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <Badge variant="destructive" className="mb-1">
                            {record.ptoType}
                          </Badge>
                          <p className="text-xs text-muted-foreground">
                            {record.startTime} - {record.endTime}
                          </p>
                        </div>
                        {/* EDIT PTO BUTTON - For existing PTO records */}
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleEditPTO(record)}
                          title="Edit PTO"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        {/* REMOVE PTO BUTTON - For existing PTO records */}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removePTOMutation.mutate(record)}
                          disabled={removePTOMutation.isPending}
                          title="Remove PTO"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );  // <-- ADD THIS CLOSING PARENTHESIS AND SEMICOLON
        })} 

        {selectedOfficer && selectedShift && (
          <PTOAssignmentDialog
            open={ptoDialogOpen}
            onOpenChange={setPtoDialogOpen}
            officer={selectedOfficer}
            shift={selectedShift}
            date={dateStr}
          />
        )}

        {/* Add Officer Dialog */}
        {isAdminOrSupervisor && selectedShiftForAdd && (
          <AddOfficerDialog
            open={addOfficerDialogOpen}
            onOpenChange={setAddOfficerDialogOpen}
            shift={selectedShiftForAdd}
            date={dateStr}
            onAddOfficer={addOfficerMutation.mutate}
            isAdding={addOfficerMutation.isPending}
          />
        )}
      </CardContent>
    </Card>
  );
};

// Simple Add Officer Dialog component
const AddOfficerDialog = ({ open, onOpenChange, shift, date, onAddOfficer, isAdding }: any) => {
  const [selectedOfficer, setSelectedOfficer] = useState("");
  const [position, setPosition] = useState("");

  const { data: officers } = useQuery({
    queryKey: ["available-officers", date, shift.id],
    queryFn: async () => {
      // Get all officers
      const { data: allOfficers, error } = await supabase
        .from("profiles")
        .select("id, full_name, badge_number")
        .order("full_name");

      if (error) throw error;

      // Get officers already scheduled for this shift and date
      const { data: scheduledOfficers } = await supabase
        .from("schedule_exceptions")
        .select("officer_id")
        .eq("date", date)
        .eq("shift_type_id", shift.id)
        .eq("is_off", false);

      const scheduledOfficerIds = scheduledOfficers?.map(s => s.officer_id) || [];

      // Filter out already scheduled officers
      return allOfficers.filter(officer => !scheduledOfficerIds.includes(officer.id));
    },
    enabled: open,
  });

  const handleAdd = () => {
    if (!selectedOfficer || !position) {
      toast.error("Please select an officer and position");
      return;
    }

    onAddOfficer({
      officerId: selectedOfficer,
      shiftId: shift.id,
      position: position
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Officer to {shift.name}</DialogTitle>
          <DialogDescription>
            Add an officer to the schedule for {date}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Officer</Label>
            <Select value={selectedOfficer} onValueChange={setSelectedOfficer}>
              <SelectTrigger>
                <SelectValue placeholder="Select officer" />
              </SelectTrigger>
              <SelectContent>
                {officers?.map((officer) => (
                  <SelectItem key={officer.id} value={officer.id}>
                    {officer.full_name} (Badge: {officer.badge_number})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Position</Label>
            <Input
              placeholder="Enter position"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            />
          </div>
          <Button onClick={handleAdd} disabled={isAdding}>
            {isAdding ? "Adding..." : "Add Officer"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
