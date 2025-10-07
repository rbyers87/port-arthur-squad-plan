import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, Clock, Edit2, Calendar } from "lucide-react";
import { OfficerProfileDialog } from "./OfficerProfileDialog";
import { OfficerScheduleManager } from "./OfficerScheduleManager";

export const StaffManagement = () => {
  const [editingOfficer, setEditingOfficer] = useState<any>(null);
  const [managingSchedule, setManagingSchedule] = useState<any>(null);

  const { data: officers, isLoading } = useQuery({
    queryKey: ["all-officers"],
    queryFn: async () => {
      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select("*");

      if (profilesError) throw profilesError;

      // Get all user roles
      const { data: rolesData, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id, role");

      if (rolesError) throw rolesError;

      // Combine the data and sort by last name
      const officers = profilesData?.map(profile => ({
        ...profile,
        roles: rolesData?.filter(r => r.user_id === profile.id).map(r => r.role) || []
      })).sort((a, b) => {
        // Extract last names (assumes last name is the last word)
        const lastNameA = a.full_name.split(' ').pop()?.toLowerCase() || '';
        const lastNameB = b.full_name.split(' ').pop()?.toLowerCase() || '';
        return lastNameA.localeCompare(lastNameB);
      });

      return officers;
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Staff Directory
        </CardTitle>
        <CardDescription>View all officers and their information</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading officers...</p>
        ) : !officers || officers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No officers found.</p>
        ) : (
          <div className="space-y-3">
            {officers.map((officer) => (
              <div key={officer.id} className="p-4 border rounded-lg">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="font-medium">{officer.full_name}</p>
                    <p className="text-sm text-muted-foreground">{officer.email}</p>
                    {officer.badge_number && (
                      <p className="text-sm text-muted-foreground">Badge: {officer.badge_number}</p>
                    )}
                    {officer.phone && (
                      <p className="text-sm text-muted-foreground">Phone: {officer.phone}</p>
                    )}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-sm">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Vacation:</span>
                        <span className="font-medium">{officer.vacation_hours || 0}h</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Sick:</span>
                        <span className="font-medium">{officer.sick_hours || 0}h</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Comp:</span>
                        <span className="font-medium">{officer.comp_hours || 0}h</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Holiday:</span>
                        <span className="font-medium">{officer.holiday_hours || 0}h</span>
                      </div>
                    </div>
                  </div>
                   <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-1">
                      {officer.roles && officer.roles.length > 0 ? (
                        officer.roles.map((role: string, idx: number) => (
                          <Badge key={idx} variant="outline" className="capitalize">
                            {role}
                          </Badge>
                        ))
                      ) : (
                        <Badge variant="outline">Officer</Badge>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingOfficer(officer)}
                      >
                        <Edit2 className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setManagingSchedule(officer)}
                      >
                        <Calendar className="h-3 w-3 mr-1" />
                        Schedule
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {editingOfficer && (
        <OfficerProfileDialog
          officer={editingOfficer}
          open={!!editingOfficer}
          onOpenChange={(open) => !open && setEditingOfficer(null)}
        />
      )}

      {managingSchedule && (
        <OfficerScheduleManager
          officer={managingSchedule}
          open={!!managingSchedule}
          onOpenChange={(open) => !open && setManagingSchedule(null)}
        />
      )}
    </Card>
  );
};
