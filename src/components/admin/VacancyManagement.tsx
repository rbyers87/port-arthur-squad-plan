// components/admin/VacancyManagement.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon, Plus, Users } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { UnderstaffedDetection } from "./UnderstaffedDetection";

export const VacancyManagement = () => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedShift, setSelectedShift] = useState<string>();
  const [minimumRequired, setMinimumRequired] = useState<string>("2");
  const queryClient = useQueryClient();

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
  });

  const { data: alerts } = useQuery({
    queryKey: ["all-vacancy-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vacancy_alerts")
        .select(`
          *,
          shift_types(name, start_time, end_time)
        `)
        .order("date", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const { data: responses } = useQuery({
    queryKey: ["vacancy-responses-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vacancy_responses")
        .select(`
          *,
          profiles(full_name, badge_number),
          vacancy_alerts(date, shift_types(name))
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createAlertMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDate || !selectedShift) {
        throw new Error("Please select date and shift");
      }

      const { error } = await supabase.from("vacancy_alerts").insert({
        date: format(selectedDate, "yyyy-MM-dd"),
        shift_type_id: selectedShift,
        minimum_required: parseInt(minimumRequired),
        current_staffing: 0,
        status: "open",
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-vacancy-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["vacancy-alerts"] });
      toast.success("Vacancy alert created");
      setDialogOpen(false);
      setSelectedDate(undefined);
      setSelectedShift(undefined);
      setMinimumRequired("2");
    },
    onError: (error: Error) => {
      toast.error("Failed to create alert: " + error.message);
    },
  });

  const closeAlertMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase
        .from("vacancy_alerts")
        .update({ status: "closed" })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-vacancy-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["vacancy-alerts"] });
      toast.success("Alert closed");
    },
  });

  return (
    <div className="space-y-6">
      {/* Automatic Understaffed Detection */}
      <UnderstaffedDetection />

      {/* Manual Alert Creation */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Manual Vacancy Alert Creation</CardTitle>
              <CardDescription>Manually create vacancy alerts for specific shifts</CardDescription>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Manual Alert
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Vacancy Alert</DialogTitle>
                  <DialogDescription>
                    Create an alert to request volunteers for an understaffed shift
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !selectedDate && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {selectedDate ? format(selectedDate, "PPP") : <span>Pick a date</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={selectedDate}
                          onSelect={setSelectedDate}
                          initialFocus
                          className="pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
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

                  <div className="space-y-2">
                    <Label>Minimum Required Officers</Label>
                    <Input
                      type="number"
                      min="1"
                      value={minimumRequired}
                      onChange={(e) => setMinimumRequired(e.target.value)}
                    />
                  </div>

                  <Button
                    className="w-full"
                    onClick={() => createAlertMutation.mutate()}
                    disabled={createAlertMutation.isPending}
                  >
                    {createAlertMutation.isPending ? "Creating..." : "Create Alert"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {!alerts || alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No vacancy alerts created yet.</p>
            ) : (
              alerts.map((alert) => (
                <div key={alert.id} className="p-4 border rounded-lg space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium">{alert.shift_types?.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(alert.date), "EEEE, MMM d, yyyy")}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Staffing: {alert.current_staffing} / {alert.minimum_required}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span
                        className={cn(
                          "text-xs px-2 py-1 rounded",
                          alert.status === "open"
                            ? "bg-green-500/10 text-green-700"
                            : "bg-gray-500/10 text-gray-700"
                        )}
                      >
                        {alert.status}
                      </span>
                      {alert.status === "open" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => closeAlertMutation.mutate(alert.id)}
                        >
                          Close Alert
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Officer Responses */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Officer Responses
          </CardTitle>
          <CardDescription>View who has responded to vacancy alerts</CardDescription>
        </CardHeader>
        <CardContent>
          {!responses || responses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No responses yet.</p>
          ) : (
            <div className="space-y-3">
              {responses.map((response) => (
                <div key={response.id} className="p-3 border rounded-lg flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {response.profiles?.full_name} (#{response.profiles?.badge_number})
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {response.vacancy_alerts?.shift_types?.name} -{" "}
                      {format(new Date(response.vacancy_alerts?.date || ""), "MMM d, yyyy")}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "text-xs px-2 py-1 rounded capitalize",
                      response.status === "interested"
                        ? "bg-green-500/10 text-green-700"
                        : "bg-red-500/10 text-red-700"
                    )}
                  >
                    {response.status.replace("_", " ")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
