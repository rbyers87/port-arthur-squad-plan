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
import { Calendar, AlertTriangle, CheckCircle, Edit2, Save, X, Clock, Trash2, UserPlus, Download } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { PTOAssignmentDialog } from "./PTOAssignmentDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePDFExport } from "@/hooks/usePDFExport";

interface DailyScheduleViewProps {
  selectedDate: Date;
  filterShiftId?: string;
  isAdminOrSupervisor?: boolean;
  userRole?: 'officer' | 'supervisor' | 'admin'; // Add userRole prop
  userId?: string;
}

export const DailyScheduleView = ({ 
  selectedDate, 
  filterShiftId = "all", 
  isAdminOrSupervisor = false,
  userRole = 'officer' // Default to most restrictive role
}: DailyScheduleViewProps) => {
  const queryClient = useQueryClient();
  const [editingSchedule, setEditingSchedule] = useState<string | null>(null);
  const [editPosition, setEditPosition] = useState("");
  const [customPosition, setCustomPosition] = useState("");
  const [editingUnitNumber, setEditingUnitNumber] = useState<string | null>(null);
  const [editUnitValue, setEditUnitValue] = useState("");
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [editNotesValue, setEditNotesValue] = useState("");
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
  const { exportToPDF } = usePDFExport();

  // Determine if user can edit based on role
  const canEdit = userRole === 'supervisor' || userRole === 'admin';

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
        .is("end_date", null);

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
        const minStaff = minimumStaffing?.find(m => m.shift_type_id === shift.id);

        // Get recurring officers for this shift
        const recurringOfficers = recurringData
          ?.filter(r => r.shift_types?.id === shift.id)
          .map(r => {
            // Check if this officer has PTO for today
            const ptoException = ptoExceptions?.find(e => 
              e.officer_id === r.officer_id && e.shift_types?.id === shift.id
            );

            // FIXED: Only exclude if FULL DAY PTO (no custom start/end times)
            const hasFullDayPTO = ptoException && !ptoException.custom_start_time && !ptoException.custom_end_time;
            if (hasFullDayPTO) {
              return null; // Exclude from regular schedule
            }

            // Check if this officer has a working exception for today
            const workingException = workingExceptions?.find(e => 
              e.officer_id === r.officer_id && e.shift_types?.id === shift.id
            );

            // FIXED: Calculate custom time for partial PTO
            let customTime = undefined;
            if (ptoException?.custom_start_time && ptoException?.custom_end_time) {
              // Show their actual working hours when they have partial PTO
              customTime = `Working: ${ptoException.custom_start_time} - ${ptoException.custom_end_time}`;
            } else if (workingException?.custom_start_time && workingException?.custom_end_time) {
              customTime = `${workingException.custom_start_time} - ${workingException.custom_end_time}`;
            }

            return {
              scheduleId: workingException ? workingException.id : r.id,
              officerId: r.officer_id,
              name: r.profiles?.full_name || "Unknown",
              badge: r.profiles?.badge_number,
              position: workingException ? workingException.position_name : r.position_name,
              unitNumber: workingException ? workingException.unit_number : null,
              notes: workingException ? workingException.notes : null,
              type: workingException ? "exception" as const : "recurring" as const,
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
              shift: shift
            };
          })
          .filter(officer => officer !== null) || [];

        // Get additional officers from working exceptions
        const additionalOfficers = workingExceptions
          ?.filter(e => 
            e.shift_types?.id === shift.id &&
            !recurringData?.some(r => r.officer_id === e.officer_id)
          )
          .map(e => {
            const ptoException = ptoExceptions?.find(p => 
              p.officer_id === e.officer_id && p.shift_types?.id === shift.id
            );
            
            const hasFullDayPTO = ptoException && !ptoException.custom_start_time && !ptoException.custom_end_time;
            if (hasFullDayPTO) {
              return null;
            }

            let customTime = undefined;
            if (ptoException?.custom_start_time && ptoException?.custom_end_time) {
              customTime = `Working: ${ptoException.custom_start_time} - ${ptoException.custom_end_time}`;
            } else if (e.custom_start_time && e.custom_end_time) {
              customTime = `${e.custom_start_time} - ${e.custom_end_time}`;
            }

            return {
              scheduleId: e.id,
              officerId: e.officer_id,
              name: e.profiles?.full_name || "Unknown",
              badge: e.profiles?.badge_number,
              position: e.position_name,
              unitNumber: e.unit_number,
              notes: e.notes,
              type: "exception" as const,
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
              shift: shift
            };
          })
          .filter(officer => officer !== null) || [];

        const allOfficers = [...recurringOfficers, ...additionalOfficers];

        // Get PTO records for this shift
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

        // Categorize officers
        const supervisors = allOfficers.filter(o => 
          o.position?.toLowerCase().includes('supervisor')
        ).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        const specialAssignmentOfficers = allOfficers.filter(o => {
          const position = o.position?.toLowerCase() || '';
          return position.includes('other') || 
                 (o.position && !predefinedPositions.includes(o.position));
        }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        const regularOfficers = allOfficers.filter(o => 
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

      const filteredSchedule = filterShiftId === "all" 
        ? scheduleByShift 
        : scheduleByShift?.filter(s => s.shift.id === filterShiftId);

      return filteredSchedule;
    },
  });

  const updatePositionMutation = useMutation({
    mutationFn: async ({ 
      scheduleId, 
      type, 
      positionName, 
      date, 
      officerId, 
      shiftTypeId, 
      currentPosition,
      unitNumber,
      notes
    }: { 
      scheduleId: string; 
      type: "recurring" | "exception";
      positionName: string;
      date?: string;
      officerId?: string;
      shiftTypeId?: string;
      currentPosition?: string;
      unitNumber?: string;
      notes?: string;
    }) => {
      if (type === "recurring") {
        const { data: existingExceptions, error: checkError } = await supabase
          .from("schedule_exceptions")
          .select("id, position_name, unit_number, notes")
          .eq("officer_id", officerId)
          .eq("date", dateStr)
          .eq("shift_type_id", shiftTypeId)
          .eq("is_off", false);

        if (checkError) throw checkError;

        if (existingExceptions && existingExceptions.length > 0) {
          const { error } = await supabase
            .from("schedule_exceptions")
            .update({ 
              position_name: positionName,
              unit_number: unitNumber,
              notes: notes
            })
            .eq("id", existingExceptions[0].id);
          
          if (error) throw error;
        } else {
          const { data: recurringSchedule, error: recurringError } = await supabase
            .from("recurring_schedules")
            .select("position_name")
            .eq("id", scheduleId)
            .single();

          if (recurringError) throw recurringError;

          if (positionName !== recurringSchedule?.position_name || unitNumber || notes) {
            const { error } = await supabase
              .from("schedule_exceptions")
              .insert({
                officer_id: officerId,
                date: dateStr,
                shift_type_id: shiftTypeId,
                is_off: false,
                position_name: positionName,
                unit_number: unitNumber,
                notes: notes,
                custom_start_time: null,
                custom_end_time: null
              });
            
            if (error) throw error;
          }
        }
      } else {
        const { error } = await supabase
          .from("schedule_exceptions")
          .update({ 
            position_name: positionName,
            unit_number: unitNumber,
            notes: notes
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
      setEditingUnitNumber(null);
      setEditUnitValue("");
      setEditingNotes(null);
      setEditNotesValue("");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update position");
    },
  });

  const removeOfficerMutation = useMutation({
    mutationFn: async (officer: any) => {
      if (officer.type === "exception") {
        const { error } = await supabase
          .from("schedule_exceptions")
          .delete()
          .eq("id", officer.scheduleId);

        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Officer removed from daily schedule");
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to remove officer");
    },
  });

  const addOfficerMutation = useMutation({
    mutationFn: async ({ officerId, shiftId, position, unitNumber, notes }: { officerId: string; shiftId: string; position: string; unitNumber?: string; notes?: string }) => {
      const { error } = await supabase
        .from("schedule_exceptions")
        .upsert({
          officer_id: officerId,
          date: dateStr,
          shift_type_id: shiftId,
          is_off: false,
          position_name: position,
          unit_number: unitNumber,
          notes: notes,
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

  const removePTOMutation = useMutation({
    mutationFn: async (ptoRecord: any) => {
      const calculateHours = (start: string, end: string) => {
        const [startHour, startMin] = start.split(":").map(Number);
        const [endHour, endMin] = end.split(":").map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;
        return (endMinutes - startMinutes) / 60;
      };

      const hoursUsed = calculateHours(ptoRecord.startTime, ptoRecord.endTime);

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

      const { error: deleteError } = await supabase
        .from("schedule_exceptions")
        .delete()
        .eq("id", ptoRecord.id);

      if (deleteError) throw deleteError;

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
      shiftTypeId: officer.shift.id,
      currentPosition: officer.position,
      unitNumber: officer.unitNumber,
      notes: officer.notes
    });
  };

  const handleSaveUnitNumber = (officer: any) => {
    updatePositionMutation.mutate({ 
      scheduleId: officer.scheduleId, 
      type: officer.type,
      positionName: officer.position,
      date: dateStr,
      officerId: officer.officerId,
      shiftTypeId: officer.shift.id,
      currentPosition: officer.position,
      unitNumber: editUnitValue,
      notes: officer.notes
    });
  };

  const handleSaveNotes = (officer: any) => {
    updatePositionMutation.mutate({ 
      scheduleId: officer.scheduleId, 
      type: officer.type,
      positionName: officer.position,
      date: dateStr,
      officerId: officer.officerId,
      shiftTypeId: officer.shift.id,
      currentPosition: officer.position,
      unitNumber: officer.unitNumber,
      notes: editNotesValue
    });
  };

  const handleEditClick = (officer: any) => {
    if (!canEdit) return; // Prevent editing for officers
    
    setEditingSchedule(`${officer.scheduleId}-${officer.type}`);
    
    const isCustomPosition = officer.position && !predefinedPositions.includes(officer.position);
    
    if (isCustomPosition) {
      setEditPosition("Other (Custom)");
      setCustomPosition(officer.position);
    } else {
      setEditPosition(officer.position || "");
      setCustomPosition("");
    }
  };

  const handleEditUnitClick = (officer: any) => {
    if (!canEdit) return; // Prevent editing for officers
    setEditingUnitNumber(`${officer.scheduleId}-${officer.type}`);
    setEditUnitValue(officer.unitNumber || "");
  };

  const handleEditNotesClick = (officer: any) => {
    if (!canEdit) return; // Prevent editing for officers
    setEditingNotes(`${officer.scheduleId}-${officer.type}`);
    setEditNotesValue(officer.notes || "");
  };

  const handleEditPTO = (ptoRecord: any) => {
    if (!canEdit) return; // Prevent editing for officers
    
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

  const handleExportShiftToPDF = async (shiftData: any) => {
    try {
      if (!shiftData) {
        toast.error("No schedule data available for PDF export");
        return;
      }

      toast.info("Generating PDF...");
      
      const result = await exportToPDF({
        selectedDate: selectedDate,
        shiftName: shiftData.shift.name,
        shiftData: shiftData
      });

      if (result.success) {
        toast.success("PDF exported successfully");
      } else {
        toast.error("Failed to export PDF");
      }
    } catch (error) {
      toast.error("Error generating PDF");
    }
  };

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
            {/* Officer Info - Left Side */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <p className="font-medium truncate">{officer.name}</p>
                <Badge variant="outline" className="text-xs shrink-0">
                  Badge #{officer.badge}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {officer.customTime && (
                  <Badge variant="secondary" className="text-xs">
                    {officer.customTime}
                  </Badge>
                )}
                {officer.type === "recurring" && (
                  <Badge variant="secondary" className="text-xs">
                    Recurring
                  </Badge>
                )}
                {/* Show partial PTO indicator */}
                {officer.hasPTO && !officer.ptoData?.isFullShift && (
                  <Badge variant="destructive" className="text-xs">
                    Partial PTO
                  </Badge>
                )}
              </div>
            </div>

            {/* Unit & Notes - Middle Section */}
            <div className="flex items-center gap-4 mx-4 min-w-0 flex-1">
              {/* Unit Number */}
              <div className="text-center min-w-16">
                <Label htmlFor={`unit-${officer.scheduleId}`} className="text-xs text-muted-foreground mb-1 block">
                  Unit
                </Label>
                {canEdit && editingUnitNumber === `${officer.scheduleId}-${officer.type}` ? (
                  <div className="flex items-center gap-1">
                    <Input
                      id={`unit-${officer.scheduleId}`}
                      placeholder="Unit #"
                      value={editUnitValue}
                      onChange={(e) => setEditUnitValue(e.target.value)}
                      className="w-16 h-8 text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={() => handleSaveUnitNumber(officer)}
                      disabled={updatePositionMutation.isPending}
                      className="h-8 w-8"
                    >
                      <Save className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingNotes(null);
                        setEditNotesValue("");
                      }}
                      className="h-8 w-8"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <div 
                    className={`text-xs p-2 rounded border border-dashed border-muted-foreground/30 ${canEdit ? 'cursor-pointer hover:bg-muted' : ''} transition-colors min-h-8 flex items-center justify-center`}
                    onClick={() => canEdit && handleEditNotesClick(officer)}
                  >
                    {officer.notes || (canEdit ? "Add notes" : "-")}
                  </div>
                )}
              </div>
            </div>

            {/* Position & Actions - Right Side */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Position Display/Edit */}
              {canEdit && editingSchedule === `${officer.scheduleId}-${officer.type}` ? (
                <div className="flex items-center gap-2">
                  <div className="space-y-2">
                    <Select value={editPosition} onValueChange={setEditPosition}>
                      <SelectTrigger className="w-32">
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
                        className="w-32"
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
                <div className="text-right min-w-24">
                  <Badge variant="secondary" className="mb-1 w-full justify-center">
                    {officer.position || "No Position"}
                  </Badge>
                  {canEdit && (
                    <div className="flex gap-1 justify-center">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEditClick(officer)}
                        title="Edit Position"
                        className="h-6 w-6"
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
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
                        className="h-6 w-6"
                      >
                        <Clock className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
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
            <div key={shiftData.shift.id} id={`shift-card-${shiftData.shift.id}`} className="border rounded-lg p-4 space-y-4">
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
                  {canEdit && (
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
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleExportShiftToPDF(shiftData)}
                    title="Export to PDF"
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Export PDF
                  </Button>
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
                      {/* Officer Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <p className="font-medium truncate">{officer.name}</p>
                          <Badge variant="outline" className="text-xs shrink-0">
                            Badge #{officer.badge}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          {officer.customTime && (
                            <Badge variant="secondary" className="text-xs">
                              {officer.customTime}
                            </Badge>
                          )}
                          {officer.type === "recurring" && (
                            <Badge variant="secondary" className="text-xs">
                              Recurring
                            </Badge>
                          )}
                          {officer.hasPTO && !officer.ptoData?.isFullShift && (
                            <Badge variant="destructive" className="text-xs">
                              Partial PTO
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Unit & Notes */}
                      <div className="flex items-center gap-4 mx-4 min-w-0 flex-1">
                        <div className="text-center min-w-16">
                          <Label className="text-xs text-muted-foreground mb-1 block">Unit</Label>
                          <Badge 
                            variant={officer.unitNumber ? "default" : "outline"} 
                            className={`w-16 ${canEdit ? 'cursor-pointer hover:bg-muted transition-colors' : ''}`}
                            onClick={() => canEdit && handleEditUnitClick(officer)}
                          >
                            {officer.unitNumber || (canEdit ? "Add" : "-")}
                          </Badge>
                        </div>
                        <div className="text-center min-w-24 flex-1">
                          <Label className="text-xs text-muted-foreground mb-1 block">Notes</Label>
                          <div 
                            className={`text-xs p-2 rounded border border-dashed border-muted-foreground/30 ${canEdit ? 'cursor-pointer hover:bg-muted' : ''} transition-colors min-h-8 flex items-center justify-center`}
                            onClick={() => canEdit && handleEditNotesClick(officer)}
                          >
                            {officer.notes || (canEdit ? "Add notes" : "-")}
                          </div>
                        </div>
                      </div>

                      {/* Position & Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right">
                          <Badge variant="default" className="bg-blue-600 mb-1">
                            Special Assignment
                          </Badge>
                          <p className="text-xs text-muted-foreground max-w-32 truncate">
                            {officer.position}
                          </p>
                          {canEdit && (
                            <div className="flex gap-1 justify-center mt-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleEditClick(officer)}
                                title="Edit Position"
                                className="h-6 w-6"
                              >
                                <Edit2 className="h-3 w-3" />
                              </Button>
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
                                className="h-6 w-6"
                              >
                                <Clock className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* PTO Section */}
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
                            {record.isFullShift ? "Full Shift" : `${record.startTime} - ${record.endTime}`}
                          </p>
                        </div>
                        {canEdit && (
                          <>
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleEditPTO(record)}
                              title="Edit PTO"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removePTOMutation.mutate(record)}
                              disabled={removePTOMutation.isPending}
                              title="Remove PTO"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {selectedOfficer && selectedShift && canEdit && (
          <PTOAssignmentDialog
            open={ptoDialogOpen}
            onOpenChange={setPtoDialogOpen}
            officer={selectedOfficer}
            shift={selectedShift}
            date={dateStr}
          />
        )}

        {/* Add Officer Dialog */}
        {canEdit && selectedShiftForAdd && (
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

// Add Officer Dialog Component
const AddOfficerDialog = ({ open, onOpenChange, shift, date, onAddOfficer, isAdding }: any) => {
  const [selectedOfficer, setSelectedOfficer] = useState("");
  const [position, setPosition] = useState("");
  const [unitNumber, setUnitNumber] = useState("");
  const [notes, setNotes] = useState("");

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
      const dayOfWeek = new Date(date).getDay();
      
      // Get recurring schedules
      const { data: recurringSchedules } = await supabase
        .from("recurring_schedules")
        .select("officer_id")
        .eq("day_of_week", dayOfWeek)
        .eq("shift_type_id", shift.id)
        .is("end_date", null);

      // Get exception schedules
      const { data: exceptionSchedules } = await supabase
        .from("schedule_exceptions")
        .select("officer_id")
        .eq("date", date)
        .eq("shift_type_id", shift.id);

      const scheduledOfficerIds = [
        ...(recurringSchedules?.map(s => s.officer_id) || []),
        ...(exceptionSchedules?.map(s => s.officer_id) || [])
      ];

      // Filter out already scheduled officers
      return allOfficers?.filter(officer => !scheduledOfficerIds.includes(officer.id)) || [];
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
      position: position,
      unitNumber: unitNumber || undefined,
      notes: notes || undefined
    });
    
    // Reset form
    setSelectedOfficer("");
    setPosition("");
    setUnitNumber("");
    setNotes("");
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
              placeholder="Enter position (e.g., District 1, Supervisor)"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Unit Number (Optional)</Label>
            <Input
              placeholder="Enter unit number"
              value={unitNumber}
              onChange={(e) => setUnitNumber(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Notes (Optional)</Label>
            <Input
              placeholder="Enter notes or special assignments"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleAdd} disabled={isAdding} className="flex-1">
              {isAdding ? "Adding..." : "Add Officer"}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
</Dialog>
);
};   
                      className="h-8 w-8"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <Badge 
                    variant={officer.unitNumber ? "default" : "outline"} 
                    className={`w-16 ${canEdit ? 'cursor-pointer hover:bg-muted transition-colors' : ''}`}
                    onClick={() => canEdit && handleEditUnitClick(officer)}
                  >
                    {officer.unitNumber || (canEdit ? "Add" : "-")}
                  </Badge>
                )}
              </div>

              {/* Notes/Assignments */}
              <div className="text-center min-w-24 flex-1">
                <Label htmlFor={`notes-${officer.scheduleId}`} className="text-xs text-muted-foreground mb-1 block">
                  Notes
                </Label>
                {canEdit && editingNotes === `${officer.scheduleId}-${officer.type}` ? (
                  <div className="flex items-center gap-1">
                    <Input
                      id={`notes-${officer.scheduleId}`}
                      placeholder="Notes..."
                      value={editNotesValue}
                      onChange={(e) => setEditNotesValue(e.target.value)}
                      className="h-8 text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={() => handleSaveNotes(officer)}
                      disabled={updatePositionMutation.isPending}
                      className="h-8 w-8"
                    >
                      <Save className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="
