import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Clock, Plus, Minus, Award } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

export const PTOManagement = () => {
  const [selectedOfficer, setSelectedOfficer] = useState<string>("");
  const [ptoType, setPtoType] = useState<string>("vacation");
  const [hours, setHours] = useState<string>("");
  const [operation, setOperation] = useState<"add" | "subtract">("add");
  const [dialogOpen, setDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: officers } = useQuery({
    queryKey: ["officers-pto"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, badge_number, sick_hours, comp_hours, vacation_hours, holiday_hours, hire_date, service_credit_override")
        .order("full_name");

      if (error) throw error;

      // Calculate service credit for each officer
      const officersWithCredit = await Promise.all(
        data.map(async (officer) => {
          const { data: creditData } = await supabase.rpc("get_service_credit", {
            profile_id: officer.id,
          });
          return {
            ...officer,
            service_credit: creditData || 0,
          };
        })
      );

      return officersWithCredit;
    },
  });

  const updatePTOMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOfficer || !hours || isNaN(Number(hours))) {
        throw new Error("Please fill in all fields with valid numbers");
      }

      const officer = officers?.find(o => o.id === selectedOfficer);
      if (!officer) throw new Error("Officer not found");

      const hoursValue = Number(hours);
      const adjustment = operation === "add" ? hoursValue : -hoursValue;

      const currentBalance = officer[`${ptoType}_hours` as keyof typeof officer] as number || 0;
      const newBalance = currentBalance + adjustment;

      if (newBalance < 0) {
        throw new Error(`Insufficient ${ptoType} hours balance`);
      }

      const { error } = await supabase
        .from("profiles")
        .update({ [`${ptoType}_hours`]: newBalance })
        .eq("id", selectedOfficer);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["officers-pto"] });
      toast.success("PTO balance updated successfully");
      setDialogOpen(false);
      setSelectedOfficer("");
      setHours("");
      setPtoType("vacation");
      setOperation("add");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const accrueAllSickTimeMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("accrue_sick_time");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["officers-pto"] });
      toast.success("Sick time accrued for all officers");
    },
    onError: (error: Error) => {
      toast.error("Failed to accrue sick time: " + error.message);
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              PTO Management
            </CardTitle>
            <CardDescription>Manage officer PTO balances</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => accrueAllSickTimeMutation.mutate()} variant="outline" size="sm">
              Accrue Sick Time (All)
            </Button>
            <Button onClick={() => setDialogOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Adjust PTO
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {officers?.map((officer) => (
            <div key={officer.id} className="p-4 border rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-medium">{officer.full_name}</p>
                  <p className="text-sm text-muted-foreground">Badge #{officer.badge_number}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Vacation</p>
                  <p className="text-lg font-semibold">{officer.vacation_hours || 0}h</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Sick</p>
                  <p className="text-lg font-semibold">{officer.sick_hours || 0}h</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Comp</p>
                  <p className="text-lg font-semibold">{officer.comp_hours || 0}h</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Holiday</p>
                  <p className="text-lg font-semibold">{officer.holiday_hours || 0}h</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Award className="h-3 w-3" />
                    Service Credit
                  </p>
                  <div className="space-y-0.5">
                    <p className="text-lg font-semibold">{officer.service_credit?.toFixed(1) || 0} yrs</p>
                    {officer.hire_date && (
                      <p className="text-xs text-muted-foreground">
                        Since {format(new Date(officer.hire_date), "MMM yyyy")}
                      </p>
                    )}
                    {officer.service_credit_override !== null && (
                      <p className="text-xs text-amber-600 dark:text-amber-500">
                        (Manually adjusted)
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust PTO Balance</DialogTitle>
            <DialogDescription>Add or subtract PTO hours for an officer</DialogDescription>
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
                      {officer.full_name} (#{officer.badge_number})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>PTO Type</Label>
              <Select value={ptoType} onValueChange={setPtoType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vacation">Vacation</SelectItem>
                  <SelectItem value="sick">Sick</SelectItem>
                  <SelectItem value="comp">Comp Time</SelectItem>
                  <SelectItem value="holiday">Holiday</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Operation</Label>
              <div className="flex gap-2">
                <Button
                  variant={operation === "add" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setOperation("add")}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add
                </Button>
                <Button
                  variant={operation === "subtract" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setOperation("subtract")}
                >
                  <Minus className="h-4 w-4 mr-2" />
                  Subtract
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Hours</Label>
              <Input
                type="number"
                placeholder="Enter hours"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                min="0"
                step="0.5"
              />
            </div>

            <Button
              className="w-full"
              onClick={() => updatePTOMutation.mutate()}
              disabled={updatePTOMutation.isPending}
            >
              {updatePTOMutation.isPending ? "Updating..." : "Update PTO Balance"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
