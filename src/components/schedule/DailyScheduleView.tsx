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
import { Calendar, AlertTriangle, CheckCircle, Edit2, Save, X, Clock, Trash2, UserPlus, Download, Building, MapPin } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { PTOAssignmentDialog } from "./PTOAssignmentDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePDFExport } from "@/hooks/usePDFExport";
import { OfficerSection } from "./OfficerSection";
import { useScheduleMutations } from "@/hooks/useScheduleMutations";
import { PREDEFINED_POSITIONS, RANK_ORDER } from "@/constants/positions";

interface DailyScheduleViewProps {
  selectedDate: Date;
  filterShiftId?: string;
  isAdminOrSupervisor?: boolean;
  userRole?: 'officer' | 'supervisor' | 'admin';
  userId?: string;
}

export const DailyScheduleView = ({ 
  selectedDate, 
  filterShiftId = "all", 
  isAdminOrSupervisor = false,
  userRole = 'officer'
}: DailyScheduleViewProps) => {
  console.log("🔄 DailyScheduleView RENDERED - User Role:", userRole);
  const queryClient = useQueryClient();
  const [editingSchedule, setEditingSchedule] = useState<string | null>(null);
  const [editPosition, setEditPosition] = useState("");
  const [customPosition, setCustomPosition] = useState("");
  const [editingUnitNumber, setEditingUnitNumber] = useState<string | null>(null);
  const [editUnitValue, setEditUnitValue] = useState("");
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [editNotesValue, setEditNotesValue] = useState("");
  const [ptoDialogOpen, setPtoDialogOpen] = useState(false);
  const [selectedOfficer, setSelectedOfficer] = useState<{
    officerId: string;
    name: string;
    scheduleId: string;
    type: "recurring" | "exception";
    existingPTO?: {
      id: string;
      ptoType: string;
      startTime: string;
      endTime: string;
      isFullShift: boolean;
    };
  } | null>(null);
  const [selectedShift, setSelectedShift] = useState<{
    id: string;
    name: string;
    start_time: string;
    end_time: string;
  } | null>(null);
  const [addOfficerDialogOpen, setAddOfficerDialogOpen] = useState(false);
  const [selectedShiftForAdd, setSelectedShiftForAdd] = useState<any>(null);
  const { exportToPDF } = usePDFExport();

  // Determine if user can edit based on role
  const canEdit = userRole === 'supervisor' || userRole === 'admin';

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const dayOfWeek = selectedDate.getDay();

  // Use centralized constants
  const predefinedPositions = PREDEFINED_POSITIONS;

  // Function to sort supervisors by rank ONLY
  const sortSupervisorsByRank = (supervisors: any[]) => {
    return supervisors.sort((a, b) => {
      const rankA = a.rank || 'Officer';
      const rankB = b.rank || 'Officer';
      return (RANK_ORDER[rankA as keyof typeof RANK_ORDER] || 99) - (RANK_ORDER[rankB as keyof typeof RANK_ORDER] || 99);
    });
  };

  // Use centralized mutation hook - NOW INCLUDES PARTNERSHIP MUTATION
  const {
    updateScheduleMutation,
    updatePTODetailsMutation,
    removeOfficerMutation,
    addOfficerMutation,
    removePTOMutation,
    updatePartnershipMutation // NEW: Added partnership mutation
  } = useScheduleMutations(dateStr);

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

      // NEW: Get default assignments for all officers for this date
      const { data: allDefaultAssignments, error: defaultAssignmentsError } = await supabase
        .from("officer_default_assignments")
        .select("*")
        .or(`end_date.is.null,end_date.gte.${dateStr}`)
        .lte("start_date", dateStr);

      if (defaultAssignmentsError) {
        console.error("Default assignments error:", defaultAssignmentsError);
        // Don't throw, just continue without default assignments
      }

      // NEW: Helper function to get default assignment for an officer
      const getDefaultAssignment = (officerId: string) => {
        if (!allDefaultAssignments) return null;
        
        const currentDate = parseISO(dateStr);
        
        return allDefaultAssignments.find(da => 
          da.officer_id === officerId &&
          parseISO(da.start_date) <= currentDate &&
          (!da.end_date || parseISO(da.end_date) >= currentDate)
        );
      };

      // Get recurring schedules for this day of week - FIXED: Explicit relationship
      const { data: recurringData, error: recurringError } = await supabase
        .from("recurring_schedules")
        .select(`
          *,
          profiles:officer_id (
            id, 
            full_name, 
            badge_number, 
            rank
          ),
          shift_types (
            id, 
            name, 
            start_time, 
            end_time
          )
        `)
        .eq("day_of_week", dayOfWeek)
        // FIX: Include schedules that are either ongoing OR end in the future
        .or(`end_date.is.null,end_date.gte.${dateStr}`);

      if (recurringError) {
        console.error("Recurring schedules error:", recurringError);
        throw recurringError;
      }

      // Get schedule exceptions for this specific date
      const { data: exceptionsData, error: exceptionsError } = await supabase
        .from("schedule_exceptions")
        .select("*")
        .eq("date", dateStr);

      if (exceptionsError) {
        console.error("Schedule exceptions error:", exceptionsError);
        throw exceptionsError;
      }

      // Get officer profiles separately to avoid relationship conflicts
      const officerIds = [...new Set(exceptionsData?.map(e => e.officer_id).filter(Boolean))];
      let officerProfiles = [];

      if (officerIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from("profiles")
          .select("id, full_name, badge_number, rank")
          .in("id", officerIds);
        
        if (profilesError) {
          console.error("❌ Profiles error:", profilesError);
        } else {
          officerProfiles = profilesData || [];
        }
      }

      // Get shift types for exceptions separately
      const shiftTypeIds = [...new Set(exceptionsData?.map(e => e.shift_type_id).filter(Boolean))];
      let exceptionShiftTypes = [];

      if (shiftTypeIds.length > 0) {
        const { data: shiftTypesData, error: shiftTypesError } = await supabase
          .from("shift_types")
          .select("id, name, start_time, end_time")
          .in("id", shiftTypeIds);
        
        if (shiftTypesError) {
          console.error("❌ Shift types error:", shiftTypesError);
        } else {
          exceptionShiftTypes = shiftTypesData || [];
        }
      }

      // Combine the data manually
      const combinedExceptions = exceptionsData?.map(exception => ({
        ...exception,
        profiles: officerProfiles.find(p => p.id === exception.officer_id),
        shift_types: exceptionShiftTypes.find(s => s.id === exception.shift_type_id)
      })) || [];

      // Separate PTO exceptions from regular exceptions
      const ptoExceptions = combinedExceptions?.filter(e => e.is_off) || [];
      const workingExceptions = combinedExceptions?.filter(e => !e.is_off) || [];

      console.log("📊 DEBUG: Data counts", {
        recurring: recurringData?.length,
        workingExceptions: workingExceptions.length,
        ptoExceptions: ptoExceptions.length,
        defaultAssignments: allDefaultAssignments?.length
      });

      // Build schedule by shift
      const scheduleByShift = shiftTypes?.map((shift) => {
        const minStaff = minimumStaffing?.find(m => m.shift_type_id === shift.id);

        // FIXED: Get ALL officers for this shift, avoiding duplicates
        const allOfficersMap = new Map();

        // Process recurring officers for this shift
        recurringData
          ?.filter(r => r.shift_types?.id === shift.id)
          .forEach(r => {
            const officerKey = `${r.officer_id}-${shift.id}`;
            
            // Check if this officer has a working exception for today
            const workingException = workingExceptions?.find(e => 
              e.officer_id === r.officer_id && e.shift_type_id === shift.id
            );

            // Check if this officer has PTO for today
            const ptoException = ptoExceptions?.find(e => 
              e.officer_id === r.officer_id && e.shift_type_id === shift.id
            );

            // NEW: Get default assignment for this officer
            const defaultAssignment = getDefaultAssignment(r.officer_id);

            // Determine effective rank for PPO check
            const officerRank = workingException?.profiles?.rank || r.profiles?.rank;
            const isProbationary = officerRank?.toLowerCase().includes('probationary');

            // FIXED: Calculate custom time for partial PTO
            let customTime = undefined;
            if (ptoException?.custom_start_time && ptoException?.custom_end_time) {
              const shiftStart = shift.start_time;
              const shiftEnd = shift.end_time;
              const ptoStart = ptoException.custom_start_time;
              const ptoEnd = ptoException.custom_end_time;
              
              if (ptoStart === shiftStart && ptoEnd !== shiftEnd) {
                customTime = `Working: ${ptoEnd} - ${shiftEnd}`;
              } else if (ptoStart !== shiftStart && ptoEnd === shiftEnd) {
                customTime = `Working: ${shiftStart} - ${ptoStart}`;
              } else if (ptoStart !== shiftStart && ptoEnd !== shiftEnd) {
                customTime = `Working: ${shiftStart}-${ptoStart} & ${ptoEnd}-${shiftEnd}`;
              } else {
                customTime = `Working: Check PTO`;
              }
            } else if (workingException?.custom_start_time && workingException?.custom_end_time) {
              customTime = `${workingException.custom_start_time} - ${workingException.custom_end_time}`;
            }

            // Use working exception data if it exists, otherwise use recurring data
            const finalData = workingException ? {
              scheduleId: workingException.id,
              officerId: r.officer_id,
              name: workingException.profiles?.full_name || r.profiles?.full_name || "Unknown",
              badge: workingException.profiles?.badge_number || r.profiles?.badge_number,
              rank: officerRank,
              isPPO: isProbationary,
              // APPLY DEFAULT ASSIGNMENT: Use working exception first, then recurring, then default
              position: workingException.position_name || r.position_name || defaultAssignment?.position_name,
              unitNumber: workingException.unit_number || r.unit_number || defaultAssignment?.unit_number,
              notes: workingException.notes,
              type: "recurring" as const,
              originalScheduleId: r.id,
              customTime: customTime,
              hasPTO: !!ptoException,
              ptoData: ptoException ? {
                id: ptoException.id,
                ptoType: ptoException.reason,
                startTime: ptoException.custom_start_time || shift.start_time,
                endTime: ptoException.custom_end_time || shift.end_time,
                isFullShift: !ptoException.custom_start_time && !ptoException.custom_end_time
              } : undefined,
              // NEW: Partnership data
              isPartnership: workingException.is_partnership || r.is_partnership,
              partnerOfficerId: workingException.partner_officer_id || r.partner_officer_id,
              shift: shift,
              isExtraShift: false
            } : {
              scheduleId: r.id,
              officerId: r.officer_id,
              name: r.profiles?.full_name || "Unknown",
              badge: r.profiles?.badge_number,
              rank: officerRank,
              isPPO: isProbationary,
              // APPLY DEFAULT ASSIGNMENT: Use recurring first, then default
              position: r.position_name || defaultAssignment?.position_name,
              unitNumber: r.unit_number || defaultAssignment?.unit_number,
              notes: null,
              type: "recurring" as const,
              originalScheduleId: r.id,
              customTime: customTime,
              hasPTO: !!ptoException,
              ptoData: ptoException ? {
                id: ptoException.id,
                ptoType: ptoException.reason,
                startTime: ptoException.custom_start_time || shift.start_time,
                endTime: ptoException.custom_end_time || shift.end_time,
                isFullShift: !ptoException.custom_start_time && !ptoException.custom_end_time
              } : undefined,
              // NEW: Partnership data
              isPartnership: r.is_partnership,
              partnerOfficerId: r.partner_officer_id,
              shift: shift,
              isExtraShift: false
            };

            allOfficersMap.set(officerKey, finalData);
          });

        // FIXED: Process additional officers from working exceptions - only add if not already in recurring
        workingExceptions
          ?.filter(e => e.shift_type_id === shift.id)
          .forEach(e => {
            const officerKey = `${e.officer_id}-${shift.id}`;
            
            // Skip if this officer is already processed as recurring
            if (allOfficersMap.has(officerKey)) {
              console.log("🔄 Skipping duplicate officer (already in recurring):", e.profiles?.full_name);
              return;
            }

            // Check if this is actually their regular recurring shift for this specific shift/day
            const isRegularRecurring = recurringData?.some(r => 
              r.officer_id === e.officer_id && 
              r.shift_types?.id === shift.id &&
              r.day_of_week === dayOfWeek
            );

            const ptoException = ptoExceptions?.find(p => 
              p.officer_id === e.officer_id && p.shift_type_id === shift.id
            );

            // Determine effective rank for PPO check
            const officerRank = e.profiles?.rank;
            const isProbationary = officerRank?.toLowerCase().includes('probationary');

            // NEW: Get default assignment for exception officers too
            const defaultAssignment = getDefaultAssignment(e.officer_id);

            // FIXED: Calculate custom time for partial PTO
            let customTime = undefined;
            if (ptoException?.custom_start_time && ptoException?.custom_end_time) {
              const shiftStart = shift.start_time;
              const shiftEnd = shift.end_time;
              const ptoStart = ptoException.custom_start_time;
              const ptoEnd = ptoException.custom_end_time;
              
              if (ptoStart === shiftStart && ptoEnd !== shiftEnd) {
                customTime = `Working: ${ptoEnd} - ${shiftEnd}`;
              } else if (ptoStart !== shiftStart && ptoEnd === shiftEnd) {
                customTime = `Working: ${shiftStart} - ${ptoStart}`;
              } else if (ptoStart !== shiftStart && ptoEnd !== shiftEnd) {
                customTime = `Working: ${shiftStart}-${ptoStart} & ${ptoEnd}-${shiftEnd}`;
              } else {
                customTime = `Working: Check PTO`;
              }
            } else if (e.custom_start_time && e.custom_end_time) {
              customTime = `${e.custom_start_time} - ${e.custom_end_time}`;
            }

            const officerData = {
              scheduleId: e.id,
              officerId: e.officer_id,
              name: e.profiles?.full_name || "Unknown",
              badge: e.profiles?.badge_number,
              rank: officerRank,
              isPPO: isProbationary,
              // APPLY DEFAULT ASSIGNMENT: Use exception first, then default
              position: e.position_name || defaultAssignment?.position_name,
              unitNumber: e.unit_number || defaultAssignment?.unit_number,
              notes: e.notes,
              type: isRegularRecurring ? "recurring" : "exception" as const,
              originalScheduleId: null,
              customTime: customTime,
              hasPTO: !!ptoException,
              ptoData: ptoException ? {
                id: ptoException.id,
                ptoType: ptoException.reason,
                startTime: ptoException.custom_start_time || shift.start_time,
                endTime: ptoException.custom_end_time || shift.end_time,
                isFullShift: !ptoException.custom_start_time && !ptoException.custom_end_time
              } : undefined,
              // NEW: Partnership data
              isPartnership: e.is_partnership,
              partnerOfficerId: e.partner_officer_id,
              shift: shift,
              isExtraShift: !isRegularRecurring
            };

            allOfficersMap.set(officerKey, officerData);
          });

        const allOfficers = Array.from(allOfficersMap.values());

// NEW: Process partnerships to combine officers and remove partners from individual listings
const processedOfficers = [];
const processedOfficerIds = new Set();
const partnershipMap = new Map(); // Track partnerships

// First pass: identify all partnerships
for (const officer of allOfficers) {
  if (officer.isPartnership && officer.partnerOfficerId) {
    partnershipMap.set(officer.officerId, officer.partnerOfficerId);
    partnershipMap.set(officer.partnerOfficerId, officer.officerId);
  }
}

// Second pass: process officers
for (const officer of allOfficers) {
  // Skip if this officer has already been processed as part of a partnership
  if (processedOfficerIds.has(officer.officerId)) {
    continue;
  }

  const partnerOfficerId = partnershipMap.get(officer.officerId);
  
  // If this officer is in a partnership
  if (partnerOfficerId) {
    const partnerOfficer = allOfficers.find(o => o.officerId === partnerOfficerId);
    
    if (partnerOfficer) {
      // Determine which officer should be the primary (non-PPO takes precedence)
      let primaryOfficer = officer;
      let secondaryOfficer = partnerOfficer;
      
      // If current officer is PPO and partner is not, make partner the primary
      if (officer.isPPO && !partnerOfficer.isPPO) {
        primaryOfficer = partnerOfficer;
        secondaryOfficer = officer;
      }
      // If both are same type, use alphabetical order
      else if (officer.isPPO === partnerOfficer.isPPO) {
        primaryOfficer = officer.name.localeCompare(partnerOfficer.name) < 0 ? officer : partnerOfficer;
        secondaryOfficer = officer.name.localeCompare(partnerOfficer.name) < 0 ? partnerOfficer : officer;
      }

      // Create combined officer entry
      const combinedOfficer = {
        ...primaryOfficer,
        isCombinedPartnership: true,
        partnerData: {
          partnerOfficerId: secondaryOfficer.officerId,
          partnerName: secondaryOfficer.name,
          partnerBadge: secondaryOfficer.badge,
          partnerRank: secondaryOfficer.rank,
          partnerIsPPO: secondaryOfficer.isPPO,
          partnerPosition: secondaryOfficer.position,
          partnerUnitNumber: secondaryOfficer.unitNumber,
          partnerScheduleId: secondaryOfficer.scheduleId,
          partnerType: secondaryOfficer.type
        },
        // Use the primary officer's position and unit number, or combine if needed
        position: primaryOfficer.position || secondaryOfficer.position,
        unitNumber: primaryOfficer.unitNumber || secondaryOfficer.unitNumber,
        // Combine notes if both have them
        notes: primaryOfficer.notes || secondaryOfficer.notes ? 
          `${primaryOfficer.notes || ''}${primaryOfficer.notes && secondaryOfficer.notes ? ' / ' : ''}${secondaryOfficer.notes || ''}`.trim() 
          : null,
        // Mark as partnership
        isPartnership: true,
        partnerOfficerId: secondaryOfficer.officerId
      };

      processedOfficers.push(combinedOfficer);
      // Mark both officers as processed
      processedOfficerIds.add(primaryOfficer.officerId);
      processedOfficerIds.add(secondaryOfficer.officerId);
    } else {
      // Partner not found, just add the officer individually
      console.warn(`Partner officer ${partnerOfficerId} not found for officer ${officer.officerId}`);
      processedOfficers.push(officer);
      processedOfficerIds.add(officer.officerId);
    }
  } else {
    // Not in a partnership, add individually
    processedOfficers.push(officer);
    processedOfficerIds.add(officer.officerId);
  }
}

        console.log(`👥 Final officers for ${shift.name}:`, processedOfficers.length, processedOfficers.map(o => ({
          name: o.name,
          type: o.type,
          isExtraShift: o.isExtraShift,
          position: o.position,
          isPPO: o.isPPO,
          isPartnership: o.isPartnership,
          isCombinedPartnership: o.isCombinedPartnership,
          partnerName: o.partnerData?.partnerName
        })));

        // Get PTO records for this shift
        const shiftPTORecords = ptoExceptions?.filter(e => 
          e.shift_type_id === shift.id
        ).map(e => ({
          id: e.id,
          officerId: e.officer_id,
          name: e.profiles?.full_name || "Unknown",
          badge: e.profiles?.badge_number,
          rank: e.profiles?.rank,
          ptoType: e.reason || "PTO",
          startTime: e.custom_start_time || shift.start_time,
          endTime: e.custom_end_time || shift.end_time,
          isFullShift: !e.custom_start_time && !e.custom_end_time,
          shiftTypeId: shift.id,
          unitNumber: e.unit_number,
          notes: e.notes
        })) || [];

        // Categorize officers - ONLY SUPERVISORS GET SORTED BY RANK
        const supervisors = sortSupervisorsByRank(
          processedOfficers.filter(o => 
            o.position?.toLowerCase().includes('supervisor')
          )
        );

        const specialAssignmentOfficers = processedOfficers.filter(o => {
          const position = o.position?.toLowerCase() || '';
          return position.includes('other') || 
                 (o.position && !PREDEFINED_POSITIONS.includes(o.position));
        }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        // Regular officers for display (includes PPOs)
        const regularOfficers = processedOfficers.filter(o => 
          !o.position?.toLowerCase().includes('supervisor') && 
          !specialAssignmentOfficers.includes(o)
        ).sort((a, b) => {
          const aMatch = a.position?.match(/district\s*(\d+)/i);
          const bMatch = b.position?.match(/district\s*(\d+)/i);
          
          if (aMatch && bMatch) {
            return parseInt(aMatch[1]) - parseInt(bMatch[1]);
          }
          
          return (a.position || '').localeCompare(b.position || '');
        });

        // === CRITICAL FIX: Calculate staffing counts matching WeeklySchedule logic ===
        
        // Count supervisors EXCLUDING those with full-day PTO
        const countedSupervisors = supervisors.filter(supervisor => {
          // Exclude supervisors with full-day PTO
          const hasFullDayPTO = supervisor.hasPTO && supervisor.ptoData?.isFullShift;
          return !hasFullDayPTO;
        });

        // Count regular officers EXCLUDING PPOs and those with full-day PTO
        const countedOfficers = regularOfficers.filter(officer => {
          // Exclude PPOs (Probationary Officers)
          const isPPO = officer.isPPO;
          // Exclude officers with full-day PTO
          const hasFullDayPTO = officer.hasPTO && officer.ptoData?.isFullShift;
          return !isPPO && !hasFullDayPTO;
        });

        console.log(`📊 Staffing counts for ${shift.name}:`, {
          totalSupervisors: supervisors.length,
          countedSupervisors: countedSupervisors.length,
          totalOfficers: regularOfficers.length,
          countedOfficers: countedOfficers.length,
          ppos: regularOfficers.filter(o => o.isPPO).length,
          fullDayPTOs: processedOfficers.filter(o => o.hasPTO && o.ptoData?.isFullShift).length,
          partnerships: processedOfficers.filter(o => o.isCombinedPartnership).length
        });

        return {
          shift,
          minSupervisors: minStaff?.minimum_supervisors || 1,
          minOfficers: minStaff?.minimum_officers || 0,
          currentSupervisors: countedSupervisors.length,
          currentOfficers: countedOfficers.length,
          supervisors,
          officers: regularOfficers,
          specialAssignmentOfficers,
          ptoRecords: shiftPTORecords,
        };
      });

      return scheduleByShift;
    },
  });

  // FIXED: Updated handlers to work with the new callback signatures
  const handleSavePosition = (officer: any, position: string) => {
    if (!position) {
      toast.error("Please select or enter a position");
      return;
    }

    updateScheduleMutation.mutate({ 
      scheduleId: officer.scheduleId, 
      type: officer.type,
      positionName: position,
      date: dateStr,
      officerId: officer.officerId,
      shiftTypeId: officer.shift.id,
      currentPosition: officer.position,
      unitNumber: officer.unitNumber,
      notes: officer.notes
    });
  };

  const handleSaveUnitNumber = (officer: any, unitNumber: string) => {
    updateScheduleMutation.mutate({ 
      scheduleId: officer.scheduleId, 
      type: officer.type,
      positionName: officer.position,
      date: dateStr,
      officerId: officer.officerId,
      shiftTypeId: officer.shift.id,
      currentPosition: officer.position,
      unitNumber: unitNumber,
      notes: officer.notes
    });
  };

  const handleSaveNotes = (officer: any, notes: string) => {
    updateScheduleMutation.mutate({ 
      scheduleId: officer.scheduleId, 
      type: officer.type,
      positionName: officer.position,
      date: dateStr,
      officerId: officer.officerId,
      shiftTypeId: officer.shift.id,
      currentPosition: officer.position,
      unitNumber: officer.unitNumber,
      notes: notes
    });
  };

  // NEW: Partnership handler
const handlePartnershipChange = (officer: any, partnerOfficerId?: string) => {
  console.log("🔄 Partnership change:", { officer, partnerOfficerId });
  
  if (!officer?.scheduleId || !officer?.officerId) {
    toast.error("Invalid officer data for partnership");
    return;
  }

  if (partnerOfficerId && !partnerOfficerId.trim()) {
    toast.error("Invalid partner officer ID");
    return;
  }

  updatePartnershipMutation.mutate({
    officer: {
      ...officer,
      // Ensure we have required fields
      date: officer.date || dateStr,
      dayOfWeek: officer.dayOfWeek || dayOfWeek,
      scheduleId: officer.scheduleId,
      officerId: officer.officerId,
      type: officer.type,
      shift: officer.shift
    },
    partnerOfficerId,
    action: partnerOfficerId ? 'create' : 'remove'
  });
};

  // FIXED: Handlers for PTO
  const handleSavePTOUnitNumber = (ptoRecord: any, unitNumber: string) => {
    updatePTODetailsMutation.mutate({
      ptoId: ptoRecord.id,
      unitNumber: unitNumber,
      notes: ptoRecord.notes
    });
  };

  const handleSavePTONotes = (ptoRecord: any, notes: string) => {
    updatePTODetailsMutation.mutate({
      ptoId: ptoRecord.id,
      unitNumber: ptoRecord.unitNumber,
      notes: notes
    });
  };

  const handleEditPTO = (ptoRecord: any) => {
    if (!canEdit) return; // Prevent editing for officers
    
    setSelectedOfficer({
      officerId: ptoRecord.officerId,
      name: ptoRecord.name,
      scheduleId: ptoRecord.id,
      type: "exception" as const,
      existingPTO: {
        id: ptoRecord.id,
        ptoType: ptoRecord.ptoType,
        startTime: ptoRecord.startTime,
        endTime: ptoRecord.endTime,
        isFullShift: ptoRecord.isFullShift
      }
    });
    setSelectedShift({
      id: ptoRecord.shiftTypeId,
      name: "Unknown Shift",
      start_time: ptoRecord.startTime,
      end_time: ptoRecord.endTime
    });
    setPtoDialogOpen(true);
  };

  const handleAddOfficer = (shiftData: any) => {
    setSelectedShiftForAdd(shiftData.shift); // Pass the entire shift object, not just the ID
    setAddOfficerDialogOpen(true);
  };

  const handleExportShiftToPDF = async (shiftData: any) => {
    try {
      if (!shiftData) {
        toast.error("No schedule data available for PDF export");
        return;
      }

      toast.info("Generating PDF...");
      
      const result = await exportToPDF({
        selectedDate: selectedDate,
        shiftName: shiftData.shift.name,
        shiftData: shiftData
      });

      if (result.success) {
        toast.success("PDF exported successfully");
      } else {
        toast.error("Failed to export PDF");
      }
    } catch (error) {
      toast.error("Error generating PDF");
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
            <div key={shiftData.shift.id} id={`shift-card-${shiftData.shift.id}`} className="border rounded-lg p-4 space-y-4">
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
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAddOfficer(shiftData)} // Pass shiftData, not just shiftData.shift
                      title="Add Officer"
                    >
                      <UserPlus className="h-4 w-4 mr-1" />
                      Add Officer
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleExportShiftToPDF(shiftData)}
                    title="Export to PDF"
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Export PDF
                  </Button>
                </div>
              </div>

              {/* Use OfficerSection components */}
              <OfficerSection
                title="Supervisors"
                officers={shiftData.supervisors}
                minCount={shiftData.minSupervisors}
                currentCount={shiftData.currentSupervisors}
                isUnderstaffed={supervisorsUnderstaffed}
                canEdit={canEdit}
                onSavePosition={handleSavePosition}
                onSaveUnitNumber={handleSaveUnitNumber}
                onSaveNotes={handleSaveNotes}
                onAssignPTO={(officer) => {
                  setSelectedOfficer({
                    officerId: officer.officerId,
                    name: officer.name,
                    scheduleId: officer.scheduleId,
                    type: officer.type,
                  });
                  setSelectedShift(officer.shift);
                  setPtoDialogOpen(true);
                }}
                onRemoveOfficer={removeOfficerMutation.mutate}
                onPartnershipChange={handlePartnershipChange} // NEW: Added partnership handler
                isUpdating={updateScheduleMutation.isPending}
                sectionType="regular"
              />

              <OfficerSection
                title="Officers"
                officers={shiftData.officers}
                minCount={shiftData.minOfficers}
                currentCount={shiftData.currentOfficers}
                isUnderstaffed={officersUnderstaffed}
                canEdit={canEdit}
                onSavePosition={handleSavePosition}
                onSaveUnitNumber={handleSaveUnitNumber}
                onSaveNotes={handleSaveNotes}
                onAssignPTO={(officer) => {
                  setSelectedOfficer({
                    officerId: officer.officerId,
                    name: officer.name,
                    scheduleId: officer.scheduleId,
                    type: officer.type,
                  });
                  setSelectedShift(officer.shift);
                  setPtoDialogOpen(true);
                }}
                onRemoveOfficer={removeOfficerMutation.mutate}
                onPartnershipChange={handlePartnershipChange} // NEW: Added partnership handler
                isUpdating={updateScheduleMutation.isPending}
                sectionType="regular"
              />

              {/* Special Assignment Section */}
              {shiftData.specialAssignmentOfficers && shiftData.specialAssignmentOfficers.length > 0 && (
                <OfficerSection
                  title="Special Assignments"
                  officers={shiftData.specialAssignmentOfficers}
                  minCount={0}
                  currentCount={shiftData.specialAssignmentOfficers.length}
                  isUnderstaffed={false}
                  canEdit={canEdit}
                  onSavePosition={handleSavePosition}
                  onSaveUnitNumber={handleSaveUnitNumber}
                  onSaveNotes={handleSaveNotes}
                  onAssignPTO={(officer) => {
                    setSelectedOfficer({
                      officerId: officer.officerId,
                      name: officer.name,
                      scheduleId: officer.scheduleId,
                      type: officer.type,
                    });
                    setSelectedShift(officer.shift);
                    setPtoDialogOpen(true);
                  }}
                  onRemoveOfficer={removeOfficerMutation.mutate}
                  onPartnershipChange={handlePartnershipChange} // NEW: Added partnership handler
                  isUpdating={updateScheduleMutation.isPending}
                  sectionType="special"
                />
              )}

              {/* PTO Section */}
              {shiftData.ptoRecords && shiftData.ptoRecords.length > 0 && (
                <OfficerSection
                  title="Time Off"
                  ptoRecords={shiftData.ptoRecords}
                  canEdit={canEdit}
                  onSaveUnitNumber={handleSavePTOUnitNumber}
                  onSaveNotes={handleSavePTONotes}
                  onEditPTO={handleEditPTO}
                  onRemovePTO={removePTOMutation.mutate}
                  isUpdating={updatePTODetailsMutation.isPending}
                  sectionType="pto"
                />
              )}
            </div>
          );
        })}

        {scheduleData?.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No schedule data available for {format(selectedDate, "EEEE, MMMM d, yyyy")}
          </div>
        )}
      </CardContent>

      {/* PTO Assignment Dialog */}
      {selectedOfficer && selectedShift && (
        <PTOAssignmentDialog
          open={ptoDialogOpen}
          onOpenChange={setPtoDialogOpen}
          officer={selectedOfficer}
          shift={selectedShift}
          date={dateStr}
        />
      )}

      {/* Add Officer Dialog */}
      <Dialog open={addOfficerDialogOpen} onOpenChange={setAddOfficerDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Officer to Schedule</DialogTitle>
            <DialogDescription>
              Add an officer to the {selectedShiftForAdd?.name} shift for {format(selectedDate, "EEEE, MMMM d, yyyy")}
            </DialogDescription>
          </DialogHeader>
          <AddOfficerForm
            shiftId={selectedShiftForAdd?.id}
            shift={selectedShiftForAdd} // Pass the entire shift object
            date={dateStr}
            onSuccess={() => {
              setAddOfficerDialogOpen(false);
              setSelectedShiftForAdd(null);
            }}
            onCancel={() => {
              setAddOfficerDialogOpen(false);
              setSelectedShiftForAdd(null);
            }}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
};

// Add Officer Form Component - NOW PROPERLY SEPARATED
const AddOfficerForm = ({ shiftId, date, onSuccess, onCancel, shift }: any) => {
  const [selectedOfficerId, setSelectedOfficerId] = useState("");
  const [position, setPosition] = useState("");
  const [unitNumber, setUnitNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [customPosition, setCustomPosition] = useState("");

  const { data: officers, isLoading } = useQuery({
    queryKey: ["available-officers", shiftId, date],
    queryFn: async () => {
      // Get all profiles
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, full_name, badge_number")
        .order("full_name");

      if (error) throw error;
      return profiles;
    },
  });

  const predefinedPositions = PREDEFINED_POSITIONS;

  const addOfficerMutation = useMutation({
    mutationFn: async () => {
      const finalPosition = position === "Other (Custom)" ? customPosition : position;
      
      if (!finalPosition) {
        throw new Error("Please select or enter a position");
      }
      
      // Check if officer already has a schedule exception for this date and shift
      const { data: existingExceptions, error: checkError } = await supabase
        .from("schedule_exceptions")
        .select("id")
        .eq("officer_id", selectedOfficerId)
        .eq("date", date)
        .eq("shift_type_id", shiftId);

      if (checkError) throw checkError;
      
      if (existingExceptions && existingExceptions.length > 0) {
        throw new Error("Officer already has a schedule for this date and shift");
      }

      // Create schedule exception
      const { data, error } = await supabase
        .from("schedule_exceptions")
        .insert({
          officer_id: selectedOfficerId,
          date: date,
          shift_type_id: shiftId,
          position_name: finalPosition,
          unit_number: unitNumber,
          notes: notes,
          is_off: false
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Officer added to schedule successfully");
      onSuccess();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to add officer to schedule");
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOfficerId) {
      toast.error("Please select an officer");
      return;
    }
    addOfficerMutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="officer">Select Officer</Label>
        <Select value={selectedOfficerId} onValueChange={setSelectedOfficerId}>
          <SelectTrigger>
            <SelectValue placeholder="Choose an officer" />
          </SelectTrigger>
          <SelectContent>
            {officers?.map((officer) => (
              <SelectItem key={officer.id} value={officer.id}>
                {officer.full_name} ({officer.badge_number})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="position">Position</Label>
        <Select value={position} onValueChange={setPosition}>
          <SelectTrigger>
            <SelectValue placeholder="Select position" />
          </SelectTrigger>
          <SelectContent>
            {predefinedPositions.map((pos) => (
              <SelectItem key={pos} value={pos}>
                {pos}
              </SelectItem>
            ))}
            <SelectItem value="Other (Custom)">Other (Custom)</SelectItem>
          </SelectContent>
        </Select>
        
        {position === "Other (Custom)" && (
          <Input
            placeholder="Enter custom position"
            value={customPosition}
            onChange={(e) => setCustomPosition(e.target.value)}
            className="mt-2"
          />
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="unitNumber">Unit Number (Optional)</Label>
        <Input
          id="unitNumber"
          placeholder="Enter unit number"
          value={unitNumber}
          onChange={(e) => setUnitNumber(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes (Optional)</Label>
        <Input
          id="notes"
          placeholder="Enter notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={addOfficerMutation.isPending}>
          {addOfficerMutation.isPending ? "Adding..." : "Add Officer"}
        </Button>
      </div>
    </form>
  );
};
