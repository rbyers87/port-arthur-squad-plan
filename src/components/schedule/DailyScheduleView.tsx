import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, AlertTriangle, CheckCircle, Edit2, Save, X, Clock } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { PTOAssignmentDialog } from "./PTOAssignmentDialog";

interface DailyScheduleViewProps {
  selectedDate: Date;
  filterShiftId?: string;
  isAdminOrSupervisor?: boolean;
  userId?: string;
}

export const DailyScheduleView = ({ selectedDate, filterShiftId = "all" }: DailyScheduleViewProps) => {
  const queryClient = useQueryClient();
  const [editingSchedule, setEditingSchedule] = useState<string | null>(null);
  const [editPosition, setEditPosition] = useState("");
  const [customPosition, setCustomPosition] = useState("");
  const [ptoDialogOpen, setPtoDialogOpen] = useState(false);
  const [selectedOfficer, setSelectedOfficer] = useState<{
    officerId: string;
    name: string;
    scheduleId: string;
    type: "recurring" | "exception";
  } | null>(null);
  const [selectedShift, setSelectedShift] = useState<{
    id: string;
    name: string;
    start_time: string;
    end_time: string;
  } | null>(null);

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const dayOfWeek = selectedDate.getDay();

  const predefinedPositions = [
    "Supervisor",
    "District 1",
    "District 2", 
    "District 3",
    "District 4",
    "District 5",
    "District 6",
    "District 7/8",
    "District 9",
    "Other (Custom)",
  ];

  const { data: scheduleData, isLoading } = useQuery({
    queryKey: ["daily-schedule", dateStr],
    queryFn: async () => {
      // Get all shift types
      const { data: shiftTypes, error: shiftError } = await supabase
        .from("shift_types")
        .select("*")
        .order("start_time");
      if (shiftError) throw shiftError;

      // Get minimum staffing requirements
      const { data: minimumStaffing, error: minError } = await supabase
        .from("minimum_staffing")
        .select("minimum_officers, minimum_supervisors, shift_type_id")
        .eq("day_of_week", dayOfWeek);
      if (minError) throw minError;

      // Get recurring schedules for this day of week
      const { data: recurring, error: recurringError } = await supabase
        .from("recurring_schedules")
        .select(`
          *,
          profiles(id, full_name, badge_number),
          shift_types(id, name, start_time, end_time)
        `)
        .eq("day_of_week", dayOfWeek)
        .lte("start_date", dateStr)
        .or(`end_date.is.null,end_date.gte.${dateStr}`);
      if (recurringError) throw recurringError;

      // Get schedule exceptions for this specific date
      const { data: exceptions, error: exceptionsError } = await supabase
        .from("schedule_exceptions")
        .select(`
          *,
          profiles(id, full_name, badge_number),
          shift_types(id, name, start_time, end_time)
        `)
        .eq("date", dateStr);
      if (exceptionsError) throw exceptionsError;

      // Separate PTO exceptions from regular exceptions
      const ptoExceptions = exceptions?.filter(e => e.is_off) || [];
      const regularExceptions = exceptions?.filter(e => !e.is_off) || [];

      // Build schedule by shift
      const scheduleByShift = shiftTypes?.map((shift) => {
        // Get minimum staffing for this shift
        const minStaff = minimumStaffing?.find(m => m.shift_type_id === shift.id);

        // Get officers scheduled for this shift (recurring + exceptions)
        // For recurring, exclude only if they have a FULL shift PTO (no working exception)
        const recurringOfficers = recurring?.filter(r => {
          if (r.shift_types?.id !== shift.id) return false;
          
          const hasPTO = ptoExceptions?.some(e => e.officer_id === r.officer_id);
          const hasWorkingTime = regularExceptions?.some(e => 
            e.officer_id === r.officer_id && e.shift_types?.id === shift.id
          );
          
          // Include if no PTO, or if PTO but also has working time (partial shift)
          return !hasPTO || hasWorkingTime;
        }) || [];

        const exceptionOfficers = regularExceptions?.filter(e => 
          e.shift_types?.id === shift.id
        ) || [];

        // Get PTO records for this shift
        const shiftPTORecords = ptoExceptions?.filter(e => 
          e.shift_types?.id === shift.id
        ).map(e => ({
          officerId: e.officer_id,
          name: e.profiles?.full_name || "Unknown",
          badge: e.profiles?.badge_number,
          ptoType: e.reason || "PTO",
          startTime: e.custom_start_time || shift.start_time,
          endTime: e.custom_end_time || shift.end_time,
        })) || [];

        const officers = [
          ...recurringOfficers.map(r => {
            // Check if they have a working exception (partial shift)
            const workingException = regularExceptions?.find(
              e => e.officer_id === r.officer_id && e.shift_types?.id === shift.id
            );
            
            return {
              scheduleId: r.id,
              officerId: r.officer_id,
              name: r.profiles?.full_name || "Unknown",
              badge: r.profiles?.badge_number,
              position: r.position_name,
              type: "recurring" as const,
              customTime: workingException 
                ? `${workingException.custom_start_time} - ${workingException.custom_end_time}`
                : undefined,
            };
          }),
          ...exceptionOfficers
            .filter(e => !recurringOfficers.some(r => r.officer_id === e.officer_id))
            .map(e => ({
              scheduleId: e.id,
              officerId: e.officer_id,
              name: e.profiles?.full_name || "Unknown",
              badge: e.profiles?.badge_number,
              position: e.position_name,
              type: "exception" as const,
              customTime: e.custom_start_time && e.custom_end_time
                ? `${e.custom_start_time} - ${e.custom_end_time}`
                : undefined,
            }))
        ];

        // Separate supervisors and officers based on position
        const supervisors = officers.filter(o => 
          o.position?.toLowerCase().includes('supervisor')
        ).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        // Special assignment officers (those with "Other (Custom)" positions or custom text)
        const specialAssignmentOfficers = officers.filter(o => {
          const position = o.position?.toLowerCase() || '';
          return position.includes('other') || 
                 (o.position && !predefinedPositions.includes(o.position));
        }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        // Regular officers (exclude supervisors and special assignments)
        const regularOfficers = officers.filter(o => 
          !o.position?.toLowerCase().includes('supervisor') && 
          !specialAssignmentOfficers.includes(o)
        ).sort((a, b) => {
          // Sort by district number if applicable
          const aMatch = a.position?.match(/district\s*(\d+)/i);
          const bMatch = b.position?.match(/district\s*(\d+)/i);
          
          if (aMatch && bMatch) {
            return parseInt(aMatch[1]) - parseInt(bMatch[1]);
          }
          
          // Fallback to alphabetical
          return (a.position || '').localeCompare(b.position || '');
        });

        return {
          shift,
          minSupervisors: minStaff?.minimum_supervisors || 1,
          minOfficers: minStaff?.minimum_officers || 0,
          currentSupervisors: supervisors.length,
          currentOfficers: regularOfficers.length,
          supervisors,
          officers: regularOfficers,
          specialAssignmentOfficers,
          ptoRecords: shiftPTORecords,
        };
      });

      // Filter by shift if needed
      const filteredSchedule = filterShiftId === "all" 
        ? scheduleByShift 
        : scheduleByShift?.filter(s => s.shift.id === filterShiftId);

      return filteredSchedule;
    },
  });

  const updatePositionMutation = useMutation({
    mutationFn: async ({ scheduleId, type, positionName }: { 
      scheduleId: string; 
      type: "recurring" | "exception";
      positionName: string;
    }) => {
      const table = type === "recurring" ? "recurring_schedules" : "schedule_exceptions";
      
      const { error } = await supabase
        .from(table)
        .update({ 
          position_name: positionName
        })
        .eq("id", scheduleId);
        
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Position updated");
      queryClient.invalidateQueries({ queryKey: ["daily-schedule"] });
      setEditingSchedule(null);
      setEditPosition("");
      setCustomPosition("");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update position");
    },
  });

  const handleSavePosition = (scheduleId: string, type: "recurring" | "exception") => {
    const finalPosition = editPosition === "Other (Custom)" ? customPosition : editPosition;
    if (!finalPosition) {
      toast.error("Please select or enter a position");
      return;
    }
    updatePositionMutation.mutate({ scheduleId, type, positionName: finalPosition });
  };

  const handleEditClick = (officer: any) => {
    setEditingSchedule(`${officer.scheduleId}-${officer.type}`);
    
    // Check if the officer's current position is a custom position
    const isCustomPosition = officer.position && !predefinedPositions.includes(officer.position);
    
    if (isCustomPosition) {
      // If it's a custom position, set to "Other (Custom)" and populate the custom field
      setEditPosition("Other (Custom)");
      setCustomPosition(officer.position);
    } else {
      // If it's a predefined position, use it directly
      setEditPosition(officer.position || "");
      setCustomPosition("");
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Daily Schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-96 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Schedule for {format(selectedDate, "EEEE, MMMM d, yyyy")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {scheduleData?.map((shiftData) => {
          const supervisorsUnderstaffed = shiftData.currentSupervisors < shiftData.minSupervisors;
          const officersUnderstaffed = shiftData.currentOfficers < shiftData.minOfficers;
          const isAnyUnderstaffed = supervisorsUnderstaffed || officersUnderstaffed;
          const isFullyStaffed = !isAnyUnderstaffed;

          return (
            <div key={shiftData.shift.id} className="border rounded-lg p-4 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{shiftData.shift.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {shiftData.shift.start_time} - {shiftData.shift.end_time}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isAnyUnderstaffed && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Understaffed
                    </Badge>
                  )}
                  {isFullyStaffed && (
                    <Badge variant="default" className="gap-1 bg-green-600">
                      <CheckCircle className="h-3 w-3" />
                      Fully Staffed
                    </Badge>
                  )}
                </div>
              </div>

              {/* Supervisors Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between border-b pb-2">
                  <h4 className="font-semibold text-sm">Supervisors</h4>
                  <Badge variant={supervisorsUnderstaffed ? "destructive" : "outline"}>
                    {shiftData.currentSupervisors} / {shiftData.minSupervisors}
                  </Badge>
                </div>
                {shiftData.supervisors.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No supervisors scheduled</p>
                ) : (
                  shiftData.supervisors.map((officer) => (
                    <div
                      key={`${officer.scheduleId}-${officer.type}`}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-md"
                    >
                      <div className="flex-1">
                        <p className="font-medium">{officer.name}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-muted-foreground">Badge #{officer.badge}</p>
                          {officer.customTime && (
                            <Badge variant="outline" className="text-xs">
                              {officer.customTime}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {editingSchedule === `${officer.scheduleId}-${officer.type}` ? (
                        <div className="flex items-center gap-2">
                          <div className="space-y-2">
                            <Select value={editPosition} onValueChange={setEditPosition}>
                              <SelectTrigger className="w-48">
                                <SelectValue placeholder="Select position" />
                              </SelectTrigger>
                              <SelectContent>
                                {predefinedPositions.map((pos) => (
                                  <SelectItem key={pos} value={pos}>
                                    {pos}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {editPosition === "Other (Custom)" && (
                              <Input
                                placeholder="Enter special assignment"
                                value={customPosition}
                                onChange={(e) => setCustomPosition(e.target.value)}
                                className="w-48"
                              />
                            )}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleSavePosition(officer.scheduleId, officer.type)}
                            disabled={updatePositionMutation.isPending}
                          >
                            <Save className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingSchedule(null);
                              setEditPosition("");
                              setCustomPosition("");
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="text-right min-w-32">
                            <Badge variant="secondary">
                              {officer.position || "No Position"}
                            </Badge>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEditClick(officer)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedOfficer({
                                officerId: officer.officerId,
                                name: officer.name,
                                scheduleId: officer.scheduleId,
                                type: officer.type,
                              });
                              setSelectedShift(shiftData.shift);
                              setPtoDialogOpen(true);
                            }}
                            title="Assign PTO"
                          >
                            <Clock className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Officers Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between border-b pb-2">
                  <h4 className="font-semibold text-sm">Officers</h4>
                  <Badge variant={officersUnderstaffed ? "destructive" : "outline"}>
                    {shiftData.currentOfficers} / {shiftData.minOfficers}
                  </Badge>
                </div>
                {shiftData.officers.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No officers scheduled</p>
                ) : (
                  shiftData.officers.map((officer) => (
                    <div
                      key={`${officer.scheduleId}-${officer.type}`}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-md"
                    >
                      <div className="flex-1">
                        <p className="font-medium">{officer.name}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-muted-foreground">Badge #{officer.badge}</p>
                          {officer.customTime && (
                            <Badge variant="outline" className="text-xs">
                              {officer.customTime}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {editingSchedule === `${officer.scheduleId}-${officer.type}` ? (
                        <div className="flex items-center gap-2">
                          <div className="space-y-2">
                            <Select value={editPosition} onValueChange={setEditPosition}>
                              <SelectTrigger className="w-48">
                                <SelectValue placeholder="Select position" />
                              </SelectTrigger>
                              <SelectContent>
                                {predefinedPositions.map((pos) => (
                                  <SelectItem key={pos} value={pos}>
                                    {pos}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {editPosition === "Other (Custom)" && (
                              <Input
                                placeholder="Enter special assignment"
                                value={customPosition}
                                onChange={(e) => setCustomPosition(e.target.value)}
                                className="w-48"
                              />
                            )}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleSavePosition(officer.scheduleId, officer.type)}
                            disabled={updatePositionMutation.isPending}
                          >
                            <Save className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingSchedule(null);
                              setEditPosition("");
                              setCustomPosition("");
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="text-right min-w-32">
                            <Badge variant="secondary">
                              {officer.position || "No Position"}
                            </Badge>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEditClick(officer)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedOfficer({
                                officerId: officer.officerId,
                                name: officer.name,
                                scheduleId: officer.scheduleId,
                                type: officer.type,
                              });
                              setSelectedShift(shiftData.shift);
                              setPtoDialogOpen(true);
                            }}
                            title="Assign PTO"
                          >
                            <Clock className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Special Assignment Section */}
              {shiftData.specialAssignmentOfficers && shiftData.specialAssignmentOfficers.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between border-b pb-2">
                    <h4 className="font-semibold text-sm">Special Assignment</h4>
                    <Badge variant="outline">{shiftData.specialAssignmentOfficers.length}</Badge>
                  </div>
                  {shiftData.specialAssignmentOfficers.map((officer) => (
                    <div
                      key={`${officer.scheduleId}-${officer.type}`}
                      className="flex items-center justify-between p-3 bg-blue-50 rounded-md border border-blue-200"
                    >
                      <div className="flex-1">
                        <p className="font-medium">{officer.name}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-muted-foreground">Badge #{officer.badge}</p>
                          {officer.customTime && (
                            <Badge variant="outline" className="text-xs">
                              {officer.customTime}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {editingSchedule === `${officer.scheduleId}-${officer.type}` ? (
                        <div className="flex items-center gap-2">
                          <div className="space-y-2">
                            <Select value={editPosition} onValueChange={setEditPosition}>
                              <SelectTrigger className="w-48">
                                <SelectValue placeholder="Select position" />
                              </SelectTrigger>
                              <SelectContent>
                                {predefinedPositions.map((pos) => (
                                  <SelectItem key={pos} value={pos}>
                                    {pos}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {editPosition === "Other (Custom)" && (
                              <Input
                                placeholder="Enter special assignment"
                                value={customPosition}
                                onChange={(e) => setCustomPosition(e.target.value)}
                                className="w-48"
                              />
                            )}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleSavePosition(officer.scheduleId, officer.type)}
                            disabled={updatePositionMutation.isPending}
                          >
                            <Save className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingSchedule(null);
                              setEditPosition("");
                              setCustomPosition("");
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="text-right">
                            <Badge variant="default" className="bg-blue-600 mb-1">
                              Special Assignment
                            </Badge>
                            <p className="text-xs text-muted-foreground max-w-32 truncate">
                              {officer.position}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEditClick(officer)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedOfficer({
                                officerId: officer.officerId,
                                name: officer.name,
                                scheduleId: officer.scheduleId,
                                type: officer.type,
                              });
                              setSelectedShift(shiftData.shift);
                              setPtoDialogOpen(true);
                            }}
                            title="Assign PTO"
                          >
                            <Clock className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Other (PTO) Section */}
              {shiftData.ptoRecords && shiftData.ptoRecords.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between border-b pb-2">
                    <h4 className="font-semibold text-sm">Other (PTO)</h4>
                    <Badge variant="outline">{shiftData.ptoRecords.length}</Badge>
                  </div>
                  {shiftData.ptoRecords.map((record, idx) => (
                    <div
                      key={`${record.officerId}-${idx}`}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-md"
                    >
                      <div className="flex-1">
                        <p className="font-medium">{record.name}</p>
                        <p className="text-sm text-muted-foreground">Badge #{record.badge}</p>
                      </div>
                      <div className="text-right">
                        <Badge variant="destructive" className="mb-1">
                          {record.ptoType}
                        </Badge>
                        <p className="text-xs text-muted-foreground">
                          {record.startTime} - {record.endTime}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {selectedOfficer && selectedShift && (
          <PTOAssignmentDialog
            open={ptoDialogOpen}
            onOpenChange={setPtoDialogOpen}
            officer={selectedOfficer}
            shift={selectedShift}
            date={dateStr}
          />
        )}
      </CardContent>
    </Card>
  );
};
