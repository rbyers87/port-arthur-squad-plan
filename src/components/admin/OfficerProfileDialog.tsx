import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Award } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface OfficerProfileDialogProps {
  officer: {
    id: string;
    full_name: string;
    email: string;
    phone?: string | null;
    badge_number?: string | null;
    hire_date?: string | null;
    service_credit_override?: number | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const OfficerProfileDialog = ({ officer, open, onOpenChange }: OfficerProfileDialogProps) => {
  const queryClient = useQueryClient();
  const [hireDate, setHireDate] = useState<Date | undefined>(
    officer.hire_date ? new Date(officer.hire_date) : undefined
  );
  const [serviceCreditOverride, setServiceCreditOverride] = useState<string>(
    officer.service_credit_override?.toString() || ""
  );
  const [calculatedCredit, setCalculatedCredit] = useState<number>(0);
  const [formData, setFormData] = useState({
    full_name: officer.full_name,
    email: officer.email,
    phone: officer.phone || "",
    badge_number: officer.badge_number || "",
  });

  useEffect(() => {
    const fetchServiceCredit = async () => {
      const { data } = await supabase.rpc("get_service_credit", {
        profile_id: officer.id,
      });
      setCalculatedCredit(data || 0);
    };
    if (open) {
      fetchServiceCredit();
    }
  }, [officer.id, open, hireDate, serviceCreditOverride]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: data.full_name,
          email: data.email,
          phone: data.phone || null,
          badge_number: data.badge_number || null,
          hire_date: hireDate ? format(hireDate, "yyyy-MM-dd") : null,
          service_credit_override: serviceCreditOverride ? Number(serviceCreditOverride) : null,
        })
        .eq("id", officer.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profile updated successfully");
      queryClient.invalidateQueries({ queryKey: ["all-officers"] });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update profile");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.full_name || !formData.email) {
      toast.error("Name and email are required");
      return;
    }
    updateProfileMutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Officer Profile</DialogTitle>
          <DialogDescription>Update officer information</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="full_name">Full Name *</Label>
            <Input
              id="full_name"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="badge_number">Badge Number</Label>
            <Input
              id="badge_number"
              value={formData.badge_number}
              onChange={(e) => setFormData({ ...formData, badge_number: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>Hire Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !hireDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {hireDate ? format(hireDate, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={hireDate}
                  onSelect={setHireDate}
                  disabled={(date) => date > new Date()}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="service_credit_override" className="flex items-center gap-2">
              <Award className="h-4 w-4" />
              Service Credit Override (Years)
            </Label>
            <Input
              id="service_credit_override"
              type="number"
              placeholder="Leave blank for auto-calculation"
              value={serviceCreditOverride}
              onChange={(e) => setServiceCreditOverride(e.target.value)}
              step="0.1"
              min="0"
            />
            <p className="text-sm text-muted-foreground">
              Current service credit: <strong>{calculatedCredit.toFixed(1)} years</strong>
              {serviceCreditOverride && ` (Override: ${Number(serviceCreditOverride).toFixed(1)} years)`}
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateProfileMutation.isPending}>
              {updateProfileMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
