import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calendar, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface OfficerScheduleManagerProps {
  officer: {
    id: string;
    full_name: string;
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
  const [newSchedule, setNewSchedule] = useState({
    day_of_week: "",
    shift_type_id: "",
    position_name: "",
  });

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
        .order("day_of_week");

      if (error) throw error;
      return data;
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
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to remove schedule");
    },
  });

  // Add schedule mutation
  const addScheduleMutation = useMutation({
    mutationFn: async (data: typeof newSchedule) => {
      const { error } = await supabase
        .from("recurring_schedules")
        .insert({
          officer_id: officer.id,
          day_of_week: parseInt(data.day_of_week),
          shift_type_id: data.shift_type_id,
          position_name: data.position_name || null,
          start_date: format(new Date(), "yyyy-MM-dd"),
        });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Schedule added");
      queryClient.invalidateQueries({ queryKey: ["officer-schedules", officer.id] });
      queryClient.invalidateQueries({ queryKey: ["weekly-schedule"] });
      setShowAddForm(false);
      setNewSchedule({ day_of_week: "", shift_type_id: "", position_name: "" });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to add schedule");
    },
  });

  const handleAddSchedule = () => {
    if (!newSchedule.day_of_week || !newSchedule.shift_type_id) {
      toast.error("Please select day and shift");
      return;
    }
    addScheduleMutation.mutate(newSchedule);
  };

  return (
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
              <Calendar className="h-4 w-4" />
              Current Schedule
            </h3>
            {schedulesLoading ? (
              <p className="text-sm text-muted-foreground">Loading schedules...</p>
            ) : !schedules || schedules.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No regular schedule set</p>
            ) : (
              <div className="space-y-2">
                {schedules.map((schedule) => (
                  <div
                    key={schedule.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          {daysOfWeek.find((d) => d.value === schedule.day_of_week)?.label}
                        </Badge>
                        <span className="font-medium">{schedule.shift_types?.name}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {schedule.shift_types?.start_time} - {schedule.shift_types?.end_time}
                      </p>
                      {schedule.position_name && (
                        <Badge variant="secondary" className="text-xs">
                          {schedule.position_name}
                        </Badge>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteScheduleMutation.mutate(schedule.id)}
                      disabled={deleteScheduleMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add New Schedule */}
          {!showAddForm ? (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Schedule Day
            </Button>
          ) : (
            <div className="border rounded-lg p-4 space-y-4">
              <h3 className="font-medium">Add New Schedule Day</h3>
              
              <div className="space-y-2">
                <Label>Day of Week</Label>
                <Select
                  value={newSchedule.day_of_week}
                  onValueChange={(value) => setNewSchedule({ ...newSchedule, day_of_week: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select day" />
                  </SelectTrigger>
                  <SelectContent>
                    {daysOfWeek.map((day) => (
                      <SelectItem key={day.value} value={day.value.toString()}>
                        {day.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Shift</Label>
                <Select
                  value={newSchedule.shift_type_id}
                  onValueChange={(value) => setNewSchedule({ ...newSchedule, shift_type_id: value })}
                >
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

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewSchedule({ day_of_week: "", shift_type_id: "", position_name: "" });
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleAddSchedule}
                  disabled={addScheduleMutation.isPending}
                >
                  {addScheduleMutation.isPending ? "Adding..." : "Add Schedule"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
