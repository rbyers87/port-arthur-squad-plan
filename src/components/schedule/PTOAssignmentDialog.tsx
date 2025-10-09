import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

interface PTOAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  officer: {
    officerId: string;
    name: string;
    scheduleId: string;
    type: "recurring" | "exception";
  };
  shift: {
    id: string;
    name: string;
    start_time: string;
    end_time: string;
  };
  date: string;
}

const PTO_TYPES = [
  { value: "vacation", label: "Vacation", column: "vacation_hours" },
  { value: "holiday", label: "Holiday", column: "holiday_hours" },
  { value: "sick", label: "Sick", column: "sick_hours" },
  { value: "comp", label: "Comp", column: "comp_hours" },
];

export const PTOAssignmentDialog = ({
  open,
  onOpenChange,
  officer,
  shift,
  date,
}: PTOAssignmentDialogProps) => {
  const queryClient = useQueryClient();
  const [ptoType, setPtoType] = useState("");
  const [isFullShift, setIsFullShift] = useState(true);
  const [startTime, setStartTime] = useState(shift.start_time);
  const [endTime, setEndTime] = useState(shift.end_time);

  const calculateHours = (start: string, end: string) => {
    const [startHour, startMin] = start.split(":").map(Number);
    const [endHour, endMin] = end.split(":").map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    return (endMinutes - startMinutes) / 60;
  };

  const assignPTOMutation = useMutation({
    mutationFn: async () => {
      const ptoStartTime = isFullShift ? shift.start_time : startTime;
      const ptoEndTime = isFullShift ? shift.end_time : endTime;
      const hoursUsed = calculateHours(ptoStartTime, ptoEndTime);

      // Get current PTO balance
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", officer.officerId)
        .single();

      if (profileError) throw profileError;

      const ptoColumn = PTO_TYPES.find((t) => t.value === ptoType)?.column;
      if (!ptoColumn) throw new Error("Invalid PTO type");

      const currentBalance = profile[ptoColumn as keyof typeof profile] as number;
      if (currentBalance < hoursUsed) {
        throw new Error(`Insufficient ${ptoType} balance. Available: ${currentBalance} hours`);
      }

      // Create PTO exception
      const { error: ptoError } = await supabase.from("schedule_exceptions").insert({
        officer_id: officer.officerId,
        date: date,
        shift_type_id: shift.id,
        is_off: true,
        reason: ptoType,
        custom_start_time: ptoStartTime,
        custom_end_time: ptoEndTime,
      });

      if (ptoError) throw ptoError;

      // If partial shift, create working time exception for the remaining time
      if (!isFullShift) {
        // Calculate the working portion (the part that's NOT PTO)
        // This is the time from PTO end to shift end
        const workStartTime = ptoEndTime;
        const workEndTime = shift.end_time;

        if (workStartTime !== workEndTime) {
          // Get the current position name
          const positionName = officer.type === "recurring" 
            ? (await supabase.from("recurring_schedules").select("position_name").eq("id", officer.scheduleId).single()).data?.position_name
            : (await supabase.from("schedule_exceptions").select("position_name").eq("id", officer.scheduleId).single()).data?.position_name;

          const { error: workError } = await supabase.from("schedule_exceptions").insert({
            officer_id: officer.officerId,
            date: date,
            shift_type_id: shift.id,
            is_off: false,
            position_name: positionName,
            custom_start_time: workStartTime,
            custom_end_time: workEndTime,
          });

          if (workError) throw workError;
        }
      }

      // Deduct PTO from balance
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          [ptoColumn]: currentBalance - hoursUsed,
        })
        .eq("id", officer.officerId);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      toast.success("PTO assigned successfully");
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
      onOpenChange(false);
      setPtoType("");
      setIsFullShift(true);
      setStartTime(shift.start_time);
      setEndTime(shift.end_time);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to assign PTO");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign PTO</DialogTitle>
          <DialogDescription>
            Assign PTO for {officer.name} on {shift.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>PTO Type</Label>
            <Select value={ptoType} onValueChange={setPtoType}>
              <SelectTrigger>
                <SelectValue placeholder="Select PTO type" />
              </SelectTrigger>
              <SelectContent>
                {PTO_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="fullShift"
              checked={isFullShift}
              onCheckedChange={(checked) => {
                setIsFullShift(checked === true);
                if (checked) {
                  setStartTime(shift.start_time);
                  setEndTime(shift.end_time);
                }
              }}
            />
            <Label htmlFor="fullShift" className="cursor-pointer">
              Full shift ({shift.start_time} - {shift.end_time})
            </Label>
          </div>

          {!isFullShift && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>PTO Start Time</Label>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>PTO End Time</Label>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
          )}

          {ptoType && (
            <div className="text-sm text-muted-foreground">
              Hours to deduct: {calculateHours(
                isFullShift ? shift.start_time : startTime,
                isFullShift ? shift.end_time : endTime
              ).toFixed(2)}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => assignPTOMutation.mutate()}
            disabled={!ptoType || assignPTOMutation.isPending}
          >
            {assignPTOMutation.isPending ? "Assigning..." : "Assign PTO"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
