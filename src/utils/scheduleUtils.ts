// src/utils/scheduleUtils.ts
import { RANK_ORDER, PREDEFINED_POSITIONS } from "@/constants/positions";

/**
 * Get last name from full name
 */
export const getLastName = (fullName: string): string => {
  return fullName?.split(' ').pop() || fullName;
};

/**
 * Sort supervisors by rank, then by last name
 */
export const sortSupervisorsByRank = (supervisors: any[]) => {
  return supervisors.sort((a, b) => {
    const rankA = a.rank || 'Officer';
    const rankB = b.rank || 'Officer';
    const rankComparison = 
      (RANK_ORDER[rankA as keyof typeof RANK_ORDER] || 99) - 
      (RANK_ORDER[rankB as keyof typeof RANK_ORDER] || 99);
    
    if (rankComparison === 0) {
      return getLastName(a.officerName || a.name || '').localeCompare(
        getLastName(b.officerName || b.name || '')
      );
    }
    
    return rankComparison;
  });
};

/**
 * Categorize and sort officers into supervisors and regular officers
 */
export const categorizeAndSortOfficers = (officers: any[]) => {
  const supervisors = officers
    .filter(officer => 
      officer.shiftInfo?.position?.toLowerCase().includes('supervisor') ||
      officer.position?.toLowerCase().includes('supervisor')
    );
  
  const sortedSupervisors = sortSupervisorsByRank(supervisors);

  const regularOfficers = officers
    .filter(officer => 
      !(officer.shiftInfo?.position?.toLowerCase().includes('supervisor') ||
        officer.position?.toLowerCase().includes('supervisor'))
    )
    .sort((a, b) => 
      getLastName(a.officerName || a.name || '').localeCompare(
        getLastName(b.officerName || b.name || '')
      )
    );

  return { supervisors: sortedSupervisors, regularOfficers };
};

/**
 * Check if position is a special assignment
 */
export const isSpecialAssignment = (position: string | undefined): boolean => {
  if (!position) return false;
  
  return position.toLowerCase().includes('other') ||
         !PREDEFINED_POSITIONS.includes(position);
};

/**
 * Calculate staffing counts excluding full-day PTO, special assignments, and probationary officers
 */
export const calculateStaffingCounts = (
  categorizedOfficers: { supervisors: any[]; regularOfficers: any[] }
) => {
  const supervisorCount = categorizedOfficers.supervisors.filter(
    officer => {
      const hasFullDayPTO = officer.shiftInfo?.hasPTO && officer.shiftInfo?.ptoData?.isFullShift;
      const isProbationary = officer.rank === 'Probationary';
      return !hasFullDayPTO && !isProbationary;
    }
  ).length;

  const officerCount = categorizedOfficers.regularOfficers.filter(officer => {
    const position = officer.shiftInfo?.position;
    const rank = officer.rank || officer.shiftInfo?.rank;
    const hasFullDayPTO = officer.shiftInfo?.hasPTO && officer.shiftInfo?.ptoData?.isFullShift;
    
    // Exclude if: full-day PTO, special assignment, or probationary
    return !hasFullDayPTO && 
           !isSpecialAssignment(position) &&
           rank !== 'Probationary';
  }).length;

  return { supervisorCount, officerCount };
};

/**
 * Minimum staffing requirements by day
 */
export const MINIMUM_STAFFING = {
  SUN: 8,
  MON: 8,
  TUE: 8,
  WED: 8,
  THU: 8,
  FRI: 9,
  SAT: 9
} as const;

/**
 * Minimum supervisors required
 */
export const MINIMUM_SUPERVISORS = 1;
