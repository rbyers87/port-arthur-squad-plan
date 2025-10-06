import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Clock } from "lucide-react";

export const StaffManagement = () => {
  const { data: officers, isLoading } = useQuery({
    queryKey: ["all-officers"],
    queryFn: async () => {
      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select("*")
        .order("full_name");

      if (profilesError) throw profilesError;

      // Get all user roles
      const { data: rolesData, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id, role");

      if (rolesError) throw rolesError;

      // Combine the data
      const officers = profilesData?.map(profile => ({
        ...profile,
        roles: rolesData?.filter(r => r.user_id === profile.id).map(r => r.role) || []
      }));

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
                    <div className="flex items-center gap-2 mt-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">PTO: {officer.pto_hours_balance || 0} hours</span>
                    </div>
                  </div>
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
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
