import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface ScheduleManagementDialogProps {
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

export const ScheduleManagementDialog = ({ open, onOpenChange }: ScheduleManagementDialogProps) => {
  const queryClient = useQueryClient();
  const [selectedOfficer, setSelectedOfficer] = useState("");
  const [selectedShift, setSelectedShift] = useState("");
  const [selectedPosition, setSelectedPosition] = useState("");
  const [selectedDay, setSelectedDay] = useState("");

  const { data: officers } = useQuery({
    queryKey: ["officers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, badge_number")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: shiftTypes } = useQuery({
    queryKey: ["shift-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_types")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: positions } = useQuery({
    queryKey: ["shift-positions", selectedShift],
    queryFn: async () => {
      if (!selectedShift) return [];
      const { data, error } = await supabase
        .from("shift_positions")
        .select("*")
        .eq("shift_type_id", selectedShift)
        .order("position_order");
      if (error) throw error;
      return data;
    },
    enabled: !!selectedShift,
  });

  const createScheduleMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("recurring_schedules")
        .insert({
          officer_id: selectedOfficer,
          shift_type_id: selectedShift,
          position_id: selectedPosition || null,
          day_of_week: parseInt(selectedDay),
          start_date: new Date().toISOString().split("T")[0],
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Recurring schedule created");
      queryClient.invalidateQueries({ queryKey: ["weekly-schedule"] });
      onOpenChange(false);
      setSelectedOfficer("");
      setSelectedShift("");
      setSelectedPosition("");
      setSelectedDay("");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create schedule");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Recurring Schedule</DialogTitle>
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
                    {officer.full_name} ({officer.badge_number})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Day of Week</Label>
            <Select value={selectedDay} onValueChange={setSelectedDay}>
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
            <Label>Shift Type</Label>
            <Select value={selectedShift} onValueChange={setSelectedShift}>
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

          {selectedShift && positions && positions.length > 0 && (
            <div className="space-y-2">
              <Label>Position (Optional)</Label>
              <Select value={selectedPosition} onValueChange={setSelectedPosition}>
                <SelectTrigger>
                  <SelectValue placeholder="Select position" />
                </SelectTrigger>
                <SelectContent>
                  {positions.map((pos) => (
                    <SelectItem key={pos.id} value={pos.id}>
                      {pos.position_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button
            className="w-full"
            onClick={() => createScheduleMutation.mutate()}
            disabled={!selectedOfficer || !selectedShift || !selectedDay || createScheduleMutation.isPending}
          >
            Create Schedule
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
