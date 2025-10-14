import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    vacation_hours?: number | null;
    sick_hours?: number | null;
    comp_hours?: number | null;
    holiday_hours?: number | null;
    rank?: string | null;
  } | null; // Allow null for new officer creation
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const OfficerProfileDialog = ({ officer, open, onOpenChange }: OfficerProfileDialogProps) => {
  const queryClient = useQueryClient();
  const isEditing = officer !== null;
  
  // Initialize state with defaults or existing officer data
  const [hireDate, setHireDate] = useState<Date | undefined>(
    officer?.hire_date ? new Date(officer.hire_date) : undefined
  );
  const [serviceCreditOverride, setServiceCreditOverride] = useState<string>(
    officer?.service_credit_override?.toString() || ""
  );
  const [calculatedCredit, setCalculatedCredit] = useState<number>(0);
  const [formData, setFormData] = useState({
    full_name: officer?.full_name || "",
    email: officer?.email || "",
    phone: officer?.phone || "",
    badge_number: officer?.badge_number || "",
    rank: officer?.rank || "Officer",
    vacation_hours: officer?.vacation_hours?.toString() || "0",
    sick_hours: officer?.sick_hours?.toString() || "0",
    comp_hours: officer?.comp_hours?.toString() || "0",
    holiday_hours: officer?.holiday_hours?.toString() || "0",
  });

  // Reset form when dialog opens/closes or officer changes
  useEffect(() => {
    if (open) {
      setHireDate(officer?.hire_date ? new Date(officer.hire_date) : undefined);
      setServiceCreditOverride(officer?.service_credit_override?.toString() || "");
      setFormData({
        full_name: officer?.full_name || "",
        email: officer?.email || "",
        phone: officer?.phone || "",
        badge_number: officer?.badge_number || "",
        rank: officer?.rank || "Officer",
        vacation_hours: officer?.vacation_hours?.toString() || "0",
        sick_hours: officer?.sick_hours?.toString() || "0",
        comp_hours: officer?.comp_hours?.toString() || "0",
        holiday_hours: officer?.holiday_hours?.toString() || "0",
      });
      
      // Only fetch service credit for existing officers
      if (officer?.id) {
        fetchServiceCredit();
      } else {
        setCalculatedCredit(0);
      }
    }
  }, [open, officer]);

  const fetchServiceCredit = async () => {
    if (!officer?.id) return;
    
    const { data } = await supabase.rpc("get_service_credit", {
      profile_id: officer.id,
    });
    setCalculatedCredit(data || 0);
  };

  // Mutation for updating existing officer
  const updateProfileMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!officer?.id) throw new Error("No officer ID provided");
      
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: data.full_name,
          email: data.email,
          phone: data.phone || null,
          badge_number: data.badge_number || null,
          rank: data.rank as "Officer" | "Sergeant" | "Lieutenant" | "Deputy Chief" | "Chief",
          hire_date: hireDate ? format(hireDate, "yyyy-MM-dd") : null,
          service_credit_override: serviceCreditOverride ? Number(serviceCreditOverride) : null,
          vacation_hours: Number(data.vacation_hours) || 0,
          sick_hours: Number(data.sick_hours) || 0,
          comp_hours: Number(data.comp_hours) || 0,
          holiday_hours: Number(data.holiday_hours) || 0,
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

  // Mutation for creating new officer
  const createProfileMutation = useMutation({
  mutationFn: async (data: typeof formData) => {
    const response = await fetch('https://ywghefarrcwbnraqyfgk.supabase.co/functions/v1/create-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: data.email,
        full_name: data.full_name,
        phone: data.phone,
        badge_number: data.badge_number,
        rank: data.rank,
        hire_date: hireDate ? format(hireDate, "yyyy-MM-dd") : null,
        service_credit_override: serviceCreditOverride ? Number(serviceCreditOverride) : null,
        vacation_hours: Number(data.vacation_hours) || 0,
        sick_hours: Number(data.sick_hours) || 0,
        comp_hours: Number(data.comp_hours) || 0,
        holiday_hours: Number(data.holiday_hours) || 0,
      }),
    })

    const result = await response.json()
    
    if (!response.ok) {
      throw new Error(result.error || 'Failed to create user')
    }
    
    return result
  },
  onSuccess: (result) => {
    toast.success(result.message || "Profile created successfully");
    queryClient.invalidateQueries({ queryKey: ["all-officers"] });
    onOpenChange(false);
  },
  onError: (error: any) => {
    toast.error(error.message);
  },
})

// Add this helper function to generate a random password
const generateRandomPassword = () => {
  return `TempPass${Math.random().toString(36).slice(-8)}!`;
};

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.full_name || !formData.email) {
      toast.error("Name and email are required");
      return;
    }

    if (isEditing) {
      updateProfileMutation.mutate(formData);
    } else {
      createProfileMutation.mutate(formData);
    }
  };

  const isPending = updateProfileMutation.isPending || createProfileMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>{isEditing ? "Edit Officer Profile" : "Create New Officer Profile"}</DialogTitle>
      <DialogDescription>
        {isEditing ? "Update officer information" : "Create a new officer profile"}
      </DialogDescription>
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
            <Label htmlFor="rank">Rank</Label>
            <Select
              value={formData.rank}
              onValueChange={(value) => setFormData({ ...formData, rank: value })}
            >
              <SelectTrigger id="rank">
                <SelectValue placeholder="Select rank" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Officer">Officer</SelectItem>
                <SelectItem value="Sergeant">Sergeant</SelectItem>
                <SelectItem value="Lieutenant">Lieutenant</SelectItem>
                <SelectItem value="Deputy Chief">Deputy Chief</SelectItem>
                <SelectItem value="Chief">Chief</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Hire Date</Label>
            <div className="flex gap-2">
              <Input
                type="date"
                value={hireDate ? format(hireDate, "yyyy-MM-dd") : ""}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value) {
                    // Parse date as local time to avoid timezone issues
                    const [year, month, day] = value.split('-').map(Number);
                    setHireDate(new Date(year, month - 1, day));
                  } else {
                    setHireDate(undefined);
                  }
                }}
                max={format(new Date(), "yyyy-MM-dd")}
                className="flex-1"
              />
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                  >
                    <CalendarIcon className="h-4 w-4" />
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
          </div>

          {isEditing && (
            <div className="space-y-2">
              <Label htmlFor="service_credit_override" className="flex items-center gap-2">
                <Award className="h-4 w-4" />
                Service Credit Adjustment (Years)
              </Label>
              <Input
                id="service_credit_override"
                type="number"
                placeholder="0 (no adjustment)"
                value={serviceCreditOverride}
                onChange={(e) => setServiceCreditOverride(e.target.value)}
                step="0.1"
              />
              <p className="text-sm text-muted-foreground">
                {hireDate ? (
                  <>
                    Calculated from hire date: <strong>{(calculatedCredit - (Number(serviceCreditOverride) || 0)).toFixed(1)} years</strong>
                    {serviceCreditOverride && ` + adjustment (${Number(serviceCreditOverride).toFixed(1)}) = ${calculatedCredit.toFixed(1)} years total`}
                  </>
                ) : (
                  <>Current service credit: <strong>{calculatedCredit.toFixed(1)} years</strong></>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                Enter positive values to add credit, negative to deduct (e.g., -2 to subtract 2 years)
              </p>
            </div>
          )}

          <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
            <h3 className="font-semibold text-sm">PTO Balances</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="vacation_hours">Vacation Hours</Label>
                <Input
                  id="vacation_hours"
                  type="number"
                  value={formData.vacation_hours}
                  onChange={(e) => setFormData({ ...formData, vacation_hours: e.target.value })}
                  step="0.5"
                  min="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sick_hours">Sick Hours</Label>
                <Input
                  id="sick_hours"
                  type="number"
                  value={formData.sick_hours}
                  onChange={(e) => setFormData({ ...formData, sick_hours: e.target.value })}
                  step="0.5"
                  min="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="comp_hours">Comp Hours</Label>
                <Input
                  id="comp_hours"
                  type="number"
                  value={formData.comp_hours}
                  onChange={(e) => setFormData({ ...formData, comp_hours: e.target.value })}
                  step="0.5"
                  min="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="holiday_hours">Holiday Hours</Label>
                <Input
                  id="holiday_hours"
                  type="number"
                  value={formData.holiday_hours}
                  onChange={(e) => setFormData({ ...formData, holiday_hours: e.target.value })}
                  step="0.5"
                  min="0"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : (isEditing ? "Save Changes" : "Create Profile")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
