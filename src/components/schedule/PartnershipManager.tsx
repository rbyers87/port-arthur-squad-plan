// src/components/schedule/PartnershipManager.tsx
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
}

export const PartnershipManager = ({ officer, onPartnershipChange }: PartnershipManagerProps) => {
  const [open, setOpen] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState("");

  const { data: availablePartners, isLoading } = useQuery({
    queryKey: ["available-partners", officer.shift.id, officer.date],
    queryFn: async () => {
      // Get all officers on the same shift for the same day
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
    enabled: open,
  });

  const handleCreatePartnership = async () => {
    if (!selectedPartner) return;
    onPartnershipChange(officer, selectedPartner);
    setOpen(false);
    setSelectedPartner("");
  };

  const handleRemovePartnership = async () => {
    onPartnershipChange(officer, undefined);
    setOpen(false);
  };

  // Display only version for non-editable view
  if (!officer.isPartnership) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="h-7">
            <Users className="h-3 w-3 mr-1" />
            Add Partner
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Partnership</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
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
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100">
          <Users className="h-3 w-3 mr-1" />
          Manage Partner
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Partnership</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
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
      </DialogContent>
    </Dialog>
  );
};
