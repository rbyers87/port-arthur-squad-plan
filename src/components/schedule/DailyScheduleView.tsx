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
import { Calendar, AlertTriangle, CheckCircle, Edit2, Save, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

interface DailyScheduleViewProps {
  selectedDate: Date;
}

export const DailyScheduleView = ({ selectedDate }: DailyScheduleViewProps) => {
  const queryClient = useQueryClient();
  const [editingSchedule, setEditingSchedule] = useState<string | null>(null);
  const [editPosition, setEditPosition] = useState("");
  const [customPosition, setCustomPosition] = useState("");

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
        .select("*")
        .eq("day_of_week", dayOfWeek);
      if (minError) throw minError;

      // Get recurring schedules for this day of week
      const { data: recurring, error: recurringError } = await supabase
        .from("recurring_schedules")
        .select(`
          *,
          profiles(id, full_name, badge_number),
          shift_types(id, name, start_time, end_time)
        `)
        .eq("day_of_week", dayOfWeek)
        .lte("start_date", dateStr)
        .or(`end_date.is.null,end_date.gte.${dateStr}`);
      if (recurringError) throw recurringError;

      // Get schedule exceptions for this specific date
      const { data: exceptions, error: exceptionsError } = await supabase
        .from("schedule_exceptions")
        .select(`
          *,
          profiles(id, full_name, badge_number),
          shift_types(id, name, start_time, end_time)
        `)
        .eq("date", dateStr);
      if (exceptionsError) throw exceptionsError;

      // Build schedule by shift
      const scheduleByShift = shiftTypes?.map((shift) => {
        // Get minimum staffing for this shift
        const minStaff = minimumStaffing?.find(m => m.shift_type_id === shift.id);

        // Get officers scheduled for this shift (recurring + exceptions)
        const recurringOfficers = recurring?.filter(r => 
          r.shift_types?.id === shift.id && 
          !exceptions?.some(e => e.officer_id === r.officer_id && e.is_off)
        ) || [];

        const exceptionOfficers = exceptions?.filter(e => 
          e.shift_types?.id === shift.id && !e.is_off
        ) || [];

        const officers = [
          ...recurringOfficers.map(r => ({
            scheduleId: r.id,
            officerId: r.officer_id,
            name: r.profiles?.full_name || "Unknown",
            badge: r.profiles?.badge_number,
            position: r.position_name,
            type: "recurring" as const,
          })),
          ...exceptionOfficers.map(e => ({
            scheduleId: e.id,
            officerId: e.officer_id,
            name: e.profiles?.full_name || "Unknown",
            badge: e.profiles?.badge_number,
            position: e.position_name,
            type: "exception" as const,
          }))
        ];

        return {
          shift,
          minStaffing: minStaff?.minimum_officers || 0,
          currentStaffing: officers.length,
          officers,
        };
      });

      return scheduleByShift;
    },
  });

  const updatePositionMutation = useMutation({
    mutationFn: async ({ scheduleId, type, positionName }: { 
      scheduleId: string; 
      type: "recurring" | "exception";
      positionName: string;
    }) => {
      const table = type === "recurring" ? "recurring_schedules" : "schedule_exceptions";
      
      const { error } = await supabase
        .from(table)
        .update({ 
          position_name: positionName
        })
        .eq("id", scheduleId);
        
      if (error) throw error;
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

  const handleSavePosition = (scheduleId: string, type: "recurring" | "exception") => {
    const finalPosition = editPosition === "Other" ? customPosition : editPosition;
    if (!finalPosition) {
      toast.error("Please select or enter a position");
      return;
    }
    updatePositionMutation.mutate({ scheduleId, type, positionName: finalPosition });
  };

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
          const isUnderstaffed = shiftData.currentStaffing < shiftData.minStaffing;
          const isFullyStaffed = shiftData.currentStaffing >= shiftData.minStaffing;

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
                  {isUnderstaffed && (
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
                  <Badge variant="outline">
                    {shiftData.currentStaffing} / {shiftData.minStaffing} officers
                  </Badge>
                </div>
              </div>

              <div className="space-y-2">
                {shiftData.officers.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No officers scheduled</p>
                ) : (
                  shiftData.officers.map((officer) => (
                    <div
                      key={`${officer.scheduleId}-${officer.type}`}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-md"
                    >
                      <div className="flex-1">
                        <p className="font-medium">{officer.name}</p>
                        <p className="text-sm text-muted-foreground">Badge #{officer.badge}</p>
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
                                <SelectItem value="Other">Other (Custom)</SelectItem>
                              </SelectContent>
                            </Select>
                            {editPosition === "Other" && (
                              <Input
                                placeholder="Enter custom position"
                                value={customPosition}
                                onChange={(e) => setCustomPosition(e.target.value)}
                                className="w-48"
                              />
                            )}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleSavePosition(officer.scheduleId, officer.type)}
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
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingSchedule(`${officer.scheduleId}-${officer.type}`);
                              setEditPosition(officer.position || "");
                            }}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
