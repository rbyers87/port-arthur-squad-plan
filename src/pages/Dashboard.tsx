import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { User } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar, Users, AlertTriangle, Clock, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useUserRole } from "@/hooks/useUserRole";
import { WeeklySchedule } from "@/components/schedule/WeeklySchedule";
import { OfficersManagement } from "@/components/schedule/OfficersManagement";
import { DailyScheduleManagement } from "@/components/schedule/DailyScheduleManagement";
import { DailyScheduleView } from "@/components/schedule/DailyScheduleView";
import { TimeOffRequests } from "@/components/time-off/TimeOffRequests";
import { VacancyManagement } from "@/components/admin/VacancyManagement";
import { StaffManagement } from "@/components/admin/StaffManagement";
import { PTOManagement } from "@/components/admin/PTOManagement";
import { logoBase64 } from "@/utils/constants.js";

const Dashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { primaryRole, isAdminOrSupervisor, loading: roleLoading } = useUserRole(user?.id);

// Add console.log here to verify it's working
  console.log(logoBase64); // ✅ This will show the base64 string in browser console
  
  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
        
      // Count active officers (those with schedules today)
      const { count: activeOfficers } = await supabase
        .from("recurring_schedules")
        .select("*", { count: "exact", head: true })
        .eq("day_of_week", new Date().getDay())
        .is("end_date", null);

      // Count open vacancies - ensure this is fresh
      const { count: openVacancies } = await supabase
        .from("vacancy_alerts")
        .select("*", { count: "exact", head: true })
        .eq("status", "open");

      return { 
        activeOfficers: activeOfficers || 0, 
        openVacancies: openVacancies || 0 
      };
    },
    enabled: isAdminOrSupervisor,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  useEffect(() => {
    // Check authentication
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate("/auth");
        return;
      }
      setUser(session.user);
      fetchProfile(session.user.id);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        navigate("/auth");
      }
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) throw error;
      setProfile(data);
    } catch (error: any) {
      console.error("Error fetching profile:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out successfully");
    navigate("/auth");
  };

  if (loading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src={logoBase64} 
              alt="Port Arthur PD Logo" 
              className="w-16 h-16 object-contain"
            />
            <div>
              <h1 className="text-xl font-bold">Port Arthur PD</h1>
              <p className="text-sm text-muted-foreground">Shift Scheduler</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="font-medium">{profile?.full_name || user?.email}</p>
              <p className="text-sm text-muted-foreground capitalize">{primaryRole}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={handleSignOut}>
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-2">Welcome back, {profile?.full_name?.split(" ")[0] || "Officer"}</h2>
          <p className="text-muted-foreground">Manage your schedule and view upcoming shifts</p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">My Schedule</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">View</div>
              <p className="text-xs text-muted-foreground">Check your upcoming shifts</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">PTO Balance</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Vacation:</span>
                  <span className="font-semibold">{profile?.vacation_hours || 0}h</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Sick:</span>
                  <span className="font-semibold">{profile?.sick_hours || 0}h</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Comp:</span>
                  <span className="font-semibold">{profile?.comp_hours || 0}h</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Holiday:</span>
                  <span className="font-semibold">{profile?.holiday_hours || 0}h</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {isAdminOrSupervisor && (
            <>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Officers</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.activeOfficers ?? "--"}</div>
                  <p className="text-xs text-muted-foreground">On duty today</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Vacancies</CardTitle>
                  <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.openVacancies ?? "--"}</div>
                  <p className="text-xs text-muted-foreground">Open positions</p>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Main Content */}
        {isAdminOrSupervisor ? (
          <Tabs defaultValue="daily" className="space-y-6">
            <TabsList className="grid w-full grid-cols-7">
              <TabsTrigger value="daily">Daily Schedule</TabsTrigger>
              <TabsTrigger value="schedule">Weekly Schedule</TabsTrigger>
              <TabsTrigger value="officers">Officers</TabsTrigger>
              <TabsTrigger value="vacancies">Vacancies</TabsTrigger>
              <TabsTrigger value="staff">Staff</TabsTrigger>
              <TabsTrigger value="requests">Time Off</TabsTrigger>
              <TabsTrigger value="pto">PTO</TabsTrigger>
            </TabsList>

            <TabsContent value="daily" className="space-y-6">
              <DailyScheduleManagement isAdminOrSupervisor={isAdminOrSupervisor} />
            </TabsContent>

            <TabsContent value="schedule" className="space-y-6">
              <WeeklySchedule userId={user!.id} isAdminOrSupervisor={isAdminOrSupervisor} />
            </TabsContent>

            <TabsContent value="officers" className="space-y-6">
              <OfficersManagement 
                userId={user!.id} 
                isAdminOrSupervisor={isAdminOrSupervisor} 
                  />
            </TabsContent>

            <TabsContent value="vacancies" className="space-y-6">
              <VacancyManagement />
            </TabsContent>

            <TabsContent value="staff" className="space-y-6">
              <StaffManagement />
            </TabsContent>

            <TabsContent value="requests" className="space-y-6">
              <TimeOffRequests userId={user!.id} isAdminOrSupervisor={isAdminOrSupervisor} />
            </TabsContent>

            <TabsContent value="pto" className="space-y-6">
              <PTOManagement />
            </TabsContent>
          </Tabs>
        ) : (
          <Tabs defaultValue="daily" className="space-y-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="daily">Daily Schedule</TabsTrigger>
              <TabsTrigger value="schedule">Weekly Schedule</TabsTrigger>
              <TabsTrigger value="requests">Time Off</TabsTrigger>
            </TabsList>

            <TabsContent value="daily" className="space-y-6">
              <DailyScheduleView 
                selectedDate={new Date()} 
                isAdminOrSupervisor={false} 
                userRole="officer" 
              />
            </TabsContent>

            <TabsContent value="schedule" className="space-y-6">
              <WeeklySchedule userId={user!.id} isAdminOrSupervisor={false} />
            </TabsContent>

            <TabsContent value="requests" className="space-y-6">
              <TimeOffRequests userId={user!.id} isAdminOrSupervisor={false} />
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
