import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar as CalendarIcon, Trash2, Plus, StopCircle, Building, MapPin, Edit } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { format, addDays } from "date-fns";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";

interface OfficerScheduleManagerProps {
  officer: {
    id: string;
    full_name: string;
    default_unit?: string | null;
    default_position?: string | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const daysOfWeek = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

export const OfficerScheduleManager = ({ officer, open, onOpenChange }: OfficerScheduleManagerProps) => {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [startDate, setStartDate] = useState<Date>(new Date());
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [shiftTypeId, setShiftTypeId] = useState("");
  const [scheduleToDelete, setScheduleToDelete] = useState<string | null>(null);
  const [unitNumber, setUnitNumber] = useState("");
  const [assignedPosition, setAssignedPosition] = useState("none");
  const [shiftPositions, setShiftPositions] = useState<string[]>([]);
  const [editingSchedule, setEditingSchedule] = useState<any>(null);
  const [showEditAssignment, setShowEditAssignment] = useState(false);
  const [bulkUnitNumber, setBulkUnitNumber] = useState("");
  const [bulkAssignedPosition, setBulkAssignedPosition] = useState("none");

  // Fetch unique shift positions
  useEffect(() => {
    const fetchShiftPositions = async () => {
      const { data, error } = await supabase
        .from('shift_positions')
        .select('position_name')
        .order('position_name');

      if (error) {
        console.error('Error fetching shift positions:', error);
        toast.error('Failed to load positions');
      } else {
        const uniquePositionNames = [...new Set(data?.map(p => p.position_name).filter(Boolean))];
        setShiftPositions(uniquePositionNames);
      }
    };

    if (open) {
      fetchShiftPositions();
    }
  }, [open]);

  // Fetch officer's recurring schedules
  const { data: schedules, isLoading: schedulesLoading } = useQuery({
    queryKey: ["officer-schedules", officer.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_schedules")
        .select(`
          *,
          shift_types(id, name, start_time, end_time)
        `)
        .eq("officer_id", officer.id)
        .order("start_date", { ascending: false });

      if (error) throw error;
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const active = data.filter(s => !s.end_date || new Date(s.end_date) >= today);
      const ended = data.filter(s => s.end_date && new Date(s.end_date) < today);
      
      return [...active, ...ended];
    },
    enabled: open,
  });

  // Fetch shift types
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
    enabled: open,
  });

  // Delete schedule mutation
  const deleteScheduleMutation = useMutation({
    mutationFn: async (scheduleId: string) => {
      const { error } = await supabase
        .from("recurring_schedules")
        .delete()
        .eq("id", scheduleId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Schedule removed");
      queryClient.invalidateQueries({ queryKey: ["officer-schedules", officer.id] });
      queryClient.invalidateQueries({ queryKey: ["weekly-schedule"] });
      setScheduleToDelete(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to remove schedule");
      setScheduleToDelete(null);
    },
  });

  // Add schedule mutation (bulk insert multiple days)
  const addScheduleMutation = useMutation({
    mutationFn: async (data: { 
      days: number[]; 
      shiftId: string; 
      start: string; 
      end?: string;
      unitNumber?: string;
      assignedPosition?: string;
    }) => {
      const schedules = data.days.map(day => ({
        officer_id: officer.id,
        day_of_week: day,
        shift_type_id: data.shiftId,
        start_date: data.start,
        end_date: data.end || null,
        unit_number: data.unitNumber || null,
        position_name: data.assignedPosition !== "none" ? data.assignedPosition : null,
      }));

      const { error } = await supabase
        .from("recurring_schedules")
        .insert(schedules);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Schedule added successfully");
      queryClient.invalidateQueries({ queryKey: ["officer-schedules", officer.id] });
      queryClient.invalidateQueries({ queryKey: ["weekly-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to add schedule");
    },
  });

  // Update schedule mutation - now updates all fields
  const updateScheduleMutation = useMutation({
    mutationFn: async ({ 
      scheduleId, 
      updates 
    }: { 
      scheduleId: string; 
      updates: { 
        day_of_week: number;
        shift_type_id: string;
        start_date: string;
        end_date?: string | null;
        unit_number?: string | null;
        position_name?: string | null;
      } 
    }) => {
      const { error } = await supabase
        .from("recurring_schedules")
        .update(updates)
        .eq("id", scheduleId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Schedule updated successfully");
      queryClient.invalidateQueries({ queryKey: ["officer-schedules", officer.id] });
      queryClient.invalidateQueries({ queryKey: ["weekly-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
      setEditingSchedule(null);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update schedule");
    },
  });

  // End schedule mutation
  const endScheduleMutation = useMutation({
    mutationFn: async ({ scheduleId, endDate }: { scheduleId: string; endDate: string }) => {
      const { error } = await supabase
        .from("recurring_schedules")
        .update({ end_date: endDate })
        .eq("id", scheduleId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Schedule ended");
      queryClient.invalidateQueries({ queryKey: ["officer-schedules", officer.id] });
      queryClient.invalidateQueries({ queryKey: ["weekly-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to end schedule");
    },
  });

  // Bulk update assignment for all active schedules
  const bulkUpdateAssignmentMutation = useMutation({
    mutationFn: async ({ unitNumber, position }: { unitNumber?: string; position?: string }) => {
      const activeSchedules = schedules?.filter(s => !s.end_date || new Date(s.end_date) >= new Date()) || [];
      
      const updates = activeSchedules.map(schedule => ({
        id: schedule.id,
        unit_number: unitNumber || null,
        position_name: position !== "none" ? position : null,
      }));

      // Update each schedule individually
      for (const update of updates) {
        const { error } = await supabase
          .from("recurring_schedules")
          .update({
            unit_number: update.unit_number,
            position_name: update.position_name
          })
          .eq("id", update.id);

        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Assignment updated for all active schedules");
      queryClient.invalidateQueries({ queryKey: ["officer-schedules", officer.id] });
      queryClient.invalidateQueries({ queryKey: ["weekly-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
      setShowEditAssignment(false);
      setBulkUnitNumber("");
      setBulkAssignedPosition("none");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update assignments");
    },
  });

  const handleAddSchedule = () => {
    if (selectedDays.length === 0) {
      toast.error("Please select at least one day");
      return;
    }
    if (!shiftTypeId) {
      toast.error("Please select a shift");
      return;
    }
    addScheduleMutation.mutate({
      days: selectedDays,
      shiftId: shiftTypeId,
      start: format(startDate, "yyyy-MM-dd"),
      end: endDate ? format(endDate, "yyyy-MM-dd") : undefined,
      unitNumber: unitNumber || undefined,
      assignedPosition: assignedPosition !== "none" ? assignedPosition : undefined,
    });
  };

  const handleEditSchedule = (schedule: any) => {
    setEditingSchedule(schedule);
    setSelectedDays([schedule.day_of_week]);
    setShiftTypeId(schedule.shift_type_id);
    setStartDate(new Date(schedule.start_date));
    setEndDate(schedule.end_date ? new Date(schedule.end_date) : undefined);
    setUnitNumber(schedule.unit_number || "");
    setAssignedPosition(schedule.position_name || "none");
  };

  const handleSaveEdit = () => {
    if (!editingSchedule) return;
    if (!shiftTypeId) {
      toast.error("Please select a shift");
      return;
    }
    if (selectedDays.length === 0) {
      toast.error("Please select at least one day");
      return;
    }

    const dayOfWeek = selectedDays[0];

    const updates = {
      day_of_week: dayOfWeek,
      shift_type_id: shiftTypeId,
      start_date: format(startDate, "yyyy-MM-dd"),
      end_date: endDate ? format(endDate, "yyyy-MM-dd") : null,
      unit_number: unitNumber || null,
      position_name: assignedPosition !== "none" ? assignedPosition : null,
    };

    updateScheduleMutation.mutate({
      scheduleId: editingSchedule.id,
      updates
    });
  };

  const handleBulkUpdateAssignment = () => {
    bulkUpdateAssignmentMutation.mutate({
      unitNumber: bulkUnitNumber || undefined,
      position: bulkAssignedPosition !== "none" ? bulkAssignedPosition : undefined,
    });
  };

  const handleEndAllSchedules = () => {
    const activeSchedules = schedules?.filter(s => !s.end_date || new Date(s.end_date) >= new Date()) || [];
    const today = format(new Date(), "yyyy-MM-dd");
    
    activeSchedules.forEach(schedule => {
      endScheduleMutation.mutate({ scheduleId: schedule.id, endDate: today });
    });
  };

  const handleDeleteAllSchedules = () => {
    const activeSchedules = schedules?.filter(s => !s.end_date || new Date(s.end_date) >= new Date()) || [];
    
    if (activeSchedules.length > 0) {
      setScheduleToDelete("all");
    }
  };

  const handleDeleteClick = (scheduleId: string) => {
    setScheduleToDelete(scheduleId);
  };

  const confirmDelete = () => {
    if (scheduleToDelete === "all") {
      // Delete all active schedules
      const activeSchedules = schedules?.filter(s => !s.end_date || new Date(s.end_date) >= new Date()) || [];
      activeSchedules.forEach(schedule => {
        deleteScheduleMutation.mutate(schedule.id);
      });
    } else if (scheduleToDelete) {
      deleteScheduleMutation.mutate(scheduleToDelete);
    }
    setScheduleToDelete(null);
  };

  const cancelDelete = () => {
    setScheduleToDelete(null);
  };

  const toggleDay = (day: number) => {
    if (editingSchedule) {
      setSelectedDays([day]);
    } else {
      setSelectedDays(prev =>
        prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
      );
    }
  };

  const resetForm = () => {
    setShowAddForm(false);
    setSelectedDays([]);
    setShiftTypeId("");
    setStartDate(new Date());
    setEndDate(undefined);
    setUnitNumber("");
    setAssignedPosition("none");
    setEditingSchedule(null);
    setShowEditAssignment(false);
    setBulkUnitNumber("");
    setBulkAssignedPosition("none");
  };

  const isEditing = !!editingSchedule;
  const activeSchedules = schedules?.filter(s => !s.end_date || new Date(s.end_date) >= new Date()) || [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Regular Schedule</DialogTitle>
            <DialogDescription>
              {officer.full_name}'s recurring work schedule
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Current Schedules */}
            <div className="space-y-2">
              <h3 className="font-medium flex items-center gap-2">
                <CalendarIcon className="h-4 w-4" />
                Regular Schedules
              </h3>
              
              {/* Bulk Edit Assignment Form - AT THE TOP */}
              {showEditAssignment && (
                <div className="border rounded-lg p-4 space-y-4 bg-blue-50/30">
                  <h3 className="font-medium flex items-center gap-2">
                    <Edit className="h-4 w-4" />
                    Edit Assignment for All Active Schedules
                  </h3>
                  
                  <div className="space-y-4 p-4 border rounded-lg bg-white">
                    <h4 className="font-medium text-sm flex items-center gap-2">
                      <Building className="h-4 w-4" />
                      Assignment Details
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="bulk-unit" className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          Unit Number
                        </Label>
                        <Input
                          id="bulk-unit"
                          placeholder="e.g., Unit 1, Patrol, Traffic"
                          value={bulkUnitNumber}
                          onChange={(e) => setBulkUnitNumber(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="bulk-position">Assigned Position</Label>
                        <Select
                          value={bulkAssignedPosition}
                          onValueChange={setBulkAssignedPosition}
                        >
                          <SelectTrigger id="bulk-position">
                            <SelectValue placeholder="Select position" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No position assigned</SelectItem>
                            {shiftPositions.map((position) => (
                              <SelectItem key={position} value={position}>
                                {position}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This will update the unit number and position for all active schedules.
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setShowEditAssignment(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleBulkUpdateAssignment}
                      disabled={bulkUpdateAssignmentMutation.isPending}
                    >
                      {bulkUpdateAssignmentMutation.isPending ? "Updating..." : "Update All Assignments"}
                    </Button>
                  </div>
                </div>
              )}

              {schedulesLoading ? (
                <p className="text-sm text-muted-foreground">Loading schedules...</p>
              ) : !schedules || schedules.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No regular schedule set</p>
              ) : (
                <div className="space-y-4">
                  {/* Active Schedules Section */}
                  {activeSchedules.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold text-green-700 dark:text-green-400">Active Schedules</h4>
                      
                      {/* Single End and Delete Buttons */}
                      <div className="flex gap-2 mb-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowEditAssignment(true)}
                          className="flex items-center gap-2"
                        >
                          <Edit className="h-4 w-4" />
                          Edit Active Schedules Assignment
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleEndAllSchedules}
                          disabled={endScheduleMutation.isPending}
                          className="flex items-center gap-2"
                        >
                          <StopCircle className="h-4 w-4" />
                          End Schedule
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDeleteAllSchedules}
                          disabled={deleteScheduleMutation.isPending}
                          className="flex items-center gap-2 text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete Schedule
                        </Button>
                      </div>

                      {activeSchedules.map((schedule) => {
                        return (
                          <div
                            key={schedule.id}
                            className="flex items-center justify-between p-3 border rounded-lg"
                          >
                            <div className="space-y-1 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline">
                                  {daysOfWeek.find((d) => d.value === schedule.day_of_week)?.label}
                                </Badge>
                                <span className="font-medium">{schedule.shift_types?.name}</span>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {schedule.shift_types?.start_time} - {schedule.shift_types?.end_time}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(schedule.start_date), "MMM d, yyyy")}
                                {schedule.end_date && ` - ${format(new Date(schedule.end_date), "MMM d, yyyy")}`}
                                {!schedule.end_date && " - Ongoing"}
                              </p>
                              <div className="flex gap-2 flex-wrap">
                                {schedule.unit_number && (
                                  <Badge variant="secondary" className="text-xs">
                                    <MapPin className="h-3 w-3 mr-1" />
                                    {schedule.unit_number}
                                  </Badge>
                                )}
                                {schedule.position_name && (
                                  <Badge variant="secondary" className="text-xs">
                                    <Building className="h-3 w-3 mr-1" />
                                    {schedule.position_name}
                                  </Badge>
                                )}
                                {(!schedule.unit_number && !schedule.position_name) && (
                                  <span className="text-xs text-muted-foreground italic">No assignment details</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Ended Schedules Section */}
                  {schedules.filter(s => s.end_date && new Date(s.end_date) < new Date()).length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold text-muted-foreground">Ended Schedules</h4>
                      {schedules
                        .filter(s => s.end_date && new Date(s.end_date) < new Date())
                        .map((schedule) => {
                          return (
                            <div
                              key={schedule.id}
                              className="flex items-center justify-between p-3 border rounded-lg opacity-60 bg-muted/50"
                            >
                              <div className="space-y-1 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge variant="secondary">
                                    {daysOfWeek.find((d) => d.value === schedule.day_of_week)?.label}
                                  </Badge>
                                  <span className="font-medium">{schedule.shift_types?.name}</span>
                                  <Badge variant="secondary" className="text-xs">
                                    Ended
                                  </Badge>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  {schedule.shift_types?.start_time} - {schedule.shift_types?.end_time}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {format(new Date(schedule.start_date), "MMM d, yyyy")}
                                  {schedule.end_date && ` - ${format(new Date(schedule.end_date), "MMM d, yyyy")}`}
                                </p>
                                <div className="flex gap-2 flex-wrap">
                                  {schedule.unit_number && (
                                    <Badge variant="secondary" className="text-xs">
                                      <MapPin className="h-3 w-3 mr-1" />
                                      {schedule.unit_number}
                                    </Badge>
                                  )}
                                  {schedule.position_name && (
                                    <Badge variant="secondary" className="text-xs">
                                      <Building className="h-3 w-3 mr-1" />
                                      {schedule.position_name}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleDeleteClick(schedule.id)}
                                  disabled={deleteScheduleMutation.isPending}
                                  title="Delete this schedule"
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Edit Schedule Form */}
            {isEditing && (
              <div className="border rounded-lg p-4 space-y-4 bg-blue-50/30">
                <h3 className="font-medium flex items-center gap-2">
                  <Edit className="h-4 w-4" />
                  Edit Schedule
                </h3>
                
                <div className="space-y-2">
                  <Label>Day of Week</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {daysOfWeek.map((day) => (
                      <div key={day.value} className="flex items-center space-x-2">
                        <Checkbox
                          id={`edit-day-${day.value}`}
                          checked={selectedDays.includes(day.value)}
                          onCheckedChange={() => toggleDay(day.value)}
                        />
                        <Label
                          htmlFor={`edit-day-${day.value}`}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {day.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Select one day for this schedule entry
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Shift</Label>
                  <Select value={shiftTypeId} onValueChange={setShiftTypeId}>
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Start Date *</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !startDate && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {startDate ? format(startDate, "PPP") : "Select date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={startDate}
                          onSelect={(date) => date && setStartDate(date)}
                          initialFocus
                          className="pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="space-y-2">
                    <Label>End Date (Optional)</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !endDate && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {endDate ? format(endDate, "PPP") : "Ongoing"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={endDate}
                          onSelect={setEndDate}
                          initialFocus
                          disabled={(date) => date < startDate}
                          className="pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                    {endDate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEndDate(undefined)}
                        className="w-full"
                      >
                        Clear End Date
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setEditingSchedule(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveEdit}
                    disabled={updateScheduleMutation.isPending}
                  >
                    {updateScheduleMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </div>
            )}

            {/* Add New Schedule */}
            {!showAddForm && !isEditing && !showEditAssignment ? (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowAddForm(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add New Work Schedule
              </Button>
            ) : showAddForm && (
              <div className="border rounded-lg p-4 space-y-4">
                <h3 className="font-medium">Create Work Schedule</h3>
                
                <div className="space-y-2">
                  <Label>Work Days (Select Multiple)</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {daysOfWeek.map((day) => (
                      <div key={day.value} className="flex items-center space-x-2">
                        <Checkbox
                          id={`day-${day.value}`}
                          checked={selectedDays.includes(day.value)}
                          onCheckedChange={() => toggleDay(day.value)}
                        />
                        <Label
                          htmlFor={`day-${day.value}`}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {day.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Shift</Label>
                  <Select value={shiftTypeId} onValueChange={setShiftTypeId}>
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Start Date *</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !startDate && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {startDate ? format(startDate, "PPP") : "Select date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={startDate}
                          onSelect={(date) => date && setStartDate(date)}
                          initialFocus
                          className="pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="space-y-2">
                    <Label>End Date (Optional)</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !endDate && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {endDate ? format(endDate, "PPP") : "Ongoing"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={endDate}
                          onSelect={setEndDate}
                          initialFocus
                          disabled={(date) => date < startDate}
                          className="pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                    {endDate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEndDate(undefined)}
                        className="w-full"
                      >
                        Clear End Date
                      </Button>
                    )}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  * Leave end date empty for ongoing schedules
                </p>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={resetForm}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddSchedule}
                    disabled={addScheduleMutation.isPending}
                  >
                    {addScheduleMutation.isPending ? "Creating..." : "Create Schedule"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!scheduleToDelete} onOpenChange={(open) => !open && setScheduleToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
            <AlertDialogDescription>
              {scheduleToDelete === "all" 
                ? "Warning, you are deleting ALL active schedules which includes their history. This action cannot be undone."
                : "Warning, you are deleting the schedule which includes the history. This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDelete}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Schedule{scheduleToDelete === "all" ? "s" : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
