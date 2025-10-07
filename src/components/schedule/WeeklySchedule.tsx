import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { format, startOfWeek, addDays } from "date-fns";
import { Calendar, Plus } from "lucide-react";
import { ScheduleManagementDialog } from "./ScheduleManagementDialog";

interface WeeklyScheduleProps {
  userId: string;
  isAdminOrSupervisor: boolean;
}

export const WeeklySchedule = ({ userId, isAdminOrSupervisor }: WeeklyScheduleProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 0 });

  const { data: schedules, isLoading } = useQuery({
    queryKey: ["weekly-schedule", userId, isAdminOrSupervisor],
    queryFn: async () => {
      const weekDates = Array.from({ length: 7 }, (_, i) => 
        format(addDays(weekStart, i), "yyyy-MM-dd")
      );

      // Get recurring schedules
      const recurringQuery = supabase
        .from("recurring_schedules")
        .select(`
          *,
          shift_types(name, start_time, end_time),
          shift_positions(position_name)
        `);

      if (!isAdminOrSupervisor) {
        recurringQuery.eq("officer_id", userId);
      }

      const { data: recurring, error: recurringError } = await recurringQuery;
      if (recurringError) throw recurringError;

      // Get exceptions
      const exceptionsQuery = supabase
        .from("schedule_exceptions")
        .select(`
          *,
          shift_types(name, start_time, end_time),
          shift_positions(position_name)
        `)
        .in("date", weekDates);

      if (!isAdminOrSupervisor) {
        exceptionsQuery.eq("officer_id", userId);
      }

      const { data: exceptions, error: exceptionsError } = await exceptionsQuery;
      if (exceptionsError) throw exceptionsError;

      return { recurring, exceptions, weekDates };
    },
  });

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

  const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Weekly Schedule - {format(weekStart, "MMM d")} - {format(addDays(weekStart, 6), "MMM d, yyyy")}
            </CardTitle>
            {isAdminOrSupervisor && (
              <Button onClick={() => setDialogOpen(true)} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Schedule
              </Button>
            )}
          </div>
        </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {schedules?.weekDates.map((date, idx) => {
            const dayOfWeek = idx;
            const exception = schedules.exceptions?.find(e => e.date === date);
            const recurring = schedules.recurring?.find(r => r.day_of_week === dayOfWeek);

            let shiftInfo = null;
            if (exception) {
              if (exception.is_off) {
                shiftInfo = { type: "Off", position: exception.reason || "Day Off" };
              } else {
                shiftInfo = {
                  type: exception.shift_types?.name || "Custom",
                  time: exception.custom_start_time && exception.custom_end_time
                    ? `${exception.custom_start_time} - ${exception.custom_end_time}`
                    : `${exception.shift_types?.start_time} - ${exception.shift_types?.end_time}`,
                  position: exception.shift_positions?.position_name,
                };
              }
            } else if (recurring) {
              shiftInfo = {
                type: recurring.shift_types?.name,
                time: `${recurring.shift_types?.start_time} - ${recurring.shift_types?.end_time}`,
                position: recurring.shift_positions?.position_name,
              };
            }

            return (
              <div
                key={date}
                className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
              >
                <div className="space-y-1">
                  <p className="font-medium">{daysOfWeek[idx]}</p>
                  <p className="text-sm text-muted-foreground">{format(new Date(date), "MMM d")}</p>
                </div>
                {shiftInfo ? (
                  <div className="text-right">
                    <p className="font-medium">{shiftInfo.type}</p>
                    {shiftInfo.time && <p className="text-sm text-muted-foreground">{shiftInfo.time}</p>}
                    {shiftInfo.position && <p className="text-sm text-muted-foreground">{shiftInfo.position}</p>}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No shift scheduled</p>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
      </Card>
      {isAdminOrSupervisor && (
        <ScheduleManagementDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      )}
    </>
  );
};
