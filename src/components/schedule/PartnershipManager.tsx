import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";

interface PartnershipManagerProps {
  officer: any;
  onPartnershipChange: (officer: any, partnerOfficerId?: string) => void;
  canEdit: boolean;
}

export const PartnershipManager = ({ officer, onPartnershipChange, canEdit }: PartnershipManagerProps) => {
  const [open, setOpen] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState("");

  const { data: availablePartners, isLoading } = useQuery({
    queryKey: ["available-partners", officer.shift.id, officer.date],
    queryFn: async () => {
      // Get officers on the same shift who aren't already in a partnership
      const { data: shiftOfficers, error } = await supabase
        .from("profiles")
        .select(`
          id,
          full_name,
          badge_number,
          rank
        `)
        .neq("id", officer.officerId) // Exclude current officer
        .order("full_name");

      if (error) throw error;
      return shiftOfficers || [];
    },
    enabled: open && canEdit,
  });

  const handleCreatePartnership = async () => {
    if (!selectedPartner) return;

    try {
      // Update the officer's record with partner information
      const updateData = {
        partner_officer_id: selectedPartner,
        is_partnership: true
      };

      let updatePromise;
      
      if (officer.type === "recurring") {
        updatePromise = supabase
          .from("recurring_schedules")
          .update(updateData)
          .eq("id", officer.scheduleId);
      } else {
        updatePromise = supabase
          .from("schedule_exceptions")
          .update(updateData)
          .eq("id", officer.scheduleId);
      }

      const { error } = await updatePromise;
      
      if (error) throw error;

      // Also update the partner's record to create the reciprocal relationship
      const partnerUpdateData = {
        partner_officer_id: officer.officerId,
        is_partnership: true
      };

      let partnerUpdatePromise;
      
      if (officer.type === "recurring") {
        partnerUpdatePromise = supabase
          .from("recurring_schedules")
          .update(partnerUpdateData)
          .eq("officer_id", selectedPartner)
          .eq("day_of_week", officer.dayOfWeek)
          .eq("shift_type_id", officer.shift.id);
      } else {
        partnerUpdatePromise = supabase
          .from("schedule_exceptions")
          .update(partnerUpdateData)
          .eq("officer_id", selectedPartner)
          .eq("date", officer.date)
          .eq("shift_type_id", officer.shift.id);
      }

      const { error: partnerError } = await partnerUpdatePromise;
      if (partnerError) throw partnerError;

      onPartnershipChange(officer, selectedPartner);
      setOpen(false);
      setSelectedPartner("");
    } catch (error) {
      console.error("Error creating partnership:", error);
    }
  };

  const handleRemovePartnership = async () => {
    try {
      // Remove partnership from current officer
      const removeData = {
        partner_officer_id: null,
        is_partnership: false
      };

      let removePromise;
      
      if (officer.type === "recurring") {
        removePromise = supabase
          .from("recurring_schedules")
          .update(removeData)
          .eq("id", officer.scheduleId);
      } else {
        removePromise = supabase
          .from("schedule_exceptions")
          .update(removeData)
          .eq("id", officer.scheduleId);
      }

      const { error } = await removePromise;
      if (error) throw error;

      // Also remove from partner's record
      if (officer.partnerData) {
        let partnerRemovePromise;
        
        if (officer.type === "recurring") {
          partnerRemovePromise = supabase
            .from("recurring_schedules")
            .update(removeData)
            .eq("officer_id", officer.partnerData.partnerOfficerId)
            .eq("day_of_week", officer.dayOfWeek)
            .eq("shift_type_id", officer.shift.id);
        } else {
          partnerRemovePromise = supabase
            .from("schedule_exceptions")
            .update(removeData)
            .eq("officer_id", officer.partnerData.partnerOfficerId)
            .eq("date", officer.date)
            .eq("shift_type_id", officer.shift.id);
        }

        const { error: partnerError } = await partnerRemovePromise;
        if (partnerError) throw partnerError;
      }

      onPartnershipChange(officer, undefined);
    } catch (error) {
      console.error("Error removing partnership:", error);
    }
  };

  if (!canEdit) {
    return officer.isPartnership ? (
      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
        <Users className="h-3 w-3 mr-1" />
        Partner: {officer.partnerData.partnerName}
      </Badge>
    ) : null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7">
          <Users className="h-3 w-3 mr-1" />
          {officer.isPartnership ? "Manage Partner" : "Add Partner"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {officer.isPartnership ? "Manage Partnership" : "Create Partnership"}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {officer.isPartnership ? (
            <div className="space-y-3">
              <div className="p-3 border rounded-lg bg-blue-50">
                <p className="font-medium">Current Partner:</p>
                <p>{officer.partnerData.partnerName} ({officer.partnerData.partnerBadge})</p>
                <p className="text-sm text-muted-foreground">{officer.partnerData.partnerRank}</p>
              </div>
              <Button 
                variant="destructive" 
                onClick={handleRemovePartnership}
                className="w-full"
              >
                Remove Partnership
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Select value={selectedPartner} onValueChange={setSelectedPartner}>
                <SelectTrigger>
                  <SelectValue placeholder="Select partner officer" />
                </SelectTrigger>
                <SelectContent>
                  {availablePartners?.map((partner) => (
                    <SelectItem key={partner.id} value={partner.id}>
                      {partner.full_name} ({partner.badge_number}) - {partner.rank}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button 
                onClick={handleCreatePartnership}
                disabled={!selectedPartner}
                className="w-full"
              >
                Create Partnership
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
