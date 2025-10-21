// components/admin/OfficersManagement.tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export const OfficersManagement = () => {
  const { data: officers, isLoading } = useQuery({
    queryKey: ["officers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("full_name");
      
      if (error) throw error;
      return data;
    }
  });

  if (isLoading) {
    return <div>Loading officers...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Officers Management
        </CardTitle>
        <CardDescription>
          Manage all officers and their profiles
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search officers..." className="pl-8" />
          </div>
          <Button>Add Officer</Button>
        </div>
        
        <div className="space-y-4">
          {officers?.map((officer) => (
            <div key={officer.id} className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <h3 className="font-medium">{officer.full_name}</h3>
                <p className="text-sm text-muted-foreground">{officer.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm capitalize px-2 py-1 bg-secondary rounded">
                  {officer.role}
                </span>
                <Button variant="outline" size="sm">Edit</Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
