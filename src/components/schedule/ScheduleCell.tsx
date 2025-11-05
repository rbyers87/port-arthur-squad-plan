// src/components/schedule/ScheduleCell.tsx
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Edit2, Trash2, Clock } from "lucide-react";
import { PREDEFINED_POSITIONS } from "@/constants/positions";

interface ScheduleCellProps {
  officer: any;
  dateStr: string;
  officerId: string;
  officerName: string;
  isAdminOrSupervisor: boolean;
  onAssignPTO: (schedule: any, dateStr: string, officerId: string, officerName: string) => void;
  onRemovePTO: (schedule: any, dateStr: string, officerId: string) => void;
  onEditAssignment: (officer: any, dateStr: string) => void;
  onRemoveOfficer: (officer: any) => void;
  isUpdating?: boolean;
  isPPO?: boolean;
  partnerInfo?: string;
}

export const ScheduleCell = ({
  officer,
  dateStr,
  officerId,
  officerName,
  isAdminOrSupervisor,
  onAssignPTO,
  onRemovePTO,
  onEditAssignment,
  onRemoveOfficer,
  isUpdating = false,
  isPPO = false,
  partnerInfo = null
}: ScheduleCellProps) => {
  // Check if this officer has any schedule data for this date
  const hasSchedule = !!officer;
  const isOff = officer?.shiftInfo?.isOff;
  const hasPTO = officer?.shiftInfo?.hasPTO;
  const position = officer?.shiftInfo?.position;
  const ptoData = officer?.shiftInfo?.ptoData;
  
  // Extra shift = schedule exception AND not their regular recurring day
  const isException = officer?.shiftInfo?.scheduleType === "exception";
  const isRegularDay = officer?.isRegularRecurringDay;
  const isExtraShift = isException && !isOff && !hasPTO && !isRegularDay;

  // Special Assignment detection (same as DailyScheduleView)
  const isSpecialAssignment = position && (
    position.toLowerCase().includes('other') ||
    (position && !PREDEFINED_POSITIONS.includes(position))
  );

  // PTO Logic
  const isFullDayPTO = hasPTO && ptoData?.isFullShift;
  const isPartialPTO = hasPTO && !ptoData?.isFullShift;

  // For PPOs, use partner display if available
  const displayPosition = isPPO && partnerInfo 
    ? `Partner with ${partnerInfo}`
    : position;

  // If no officer data at all, this is an unscheduled day (dark gray)
  if (!hasSchedule) {
    return (
      <div className="p-2 border-r bg-gray-300 dark:bg-gray-600 min-h-10 relative">
        {/* Dark gray for unscheduled days */}
      </div>
    );
  }

  return (
    <div className={`
      p-2 border-r min-h-10 relative group
      ${isOff ? 'bg-muted/50' : ''}
      ${isFullDayPTO ? 'bg-green-50 border-green-200' : ''}
      ${isPartialPTO ? 'bg-white' : ''}
      ${!isOff && !hasPTO ? 'bg-white' : ''}
      ${isPPO ? 'bg-blue-50/30' : ''}
    `}>
      {isOff ? (
        <div className="text-center text-muted-foreground font-medium">DD</div>
      ) : hasPTO ? (
        <div className="text-center">
          {/* PTO Badge */}
          <Badge className={`text-xs ${
            isFullDayPTO 
              ? 'bg-green-100 text-green-800 hover:bg-green-200 border-green-200' 
              : 'bg-green-100 text-green-800 hover:bg-green-200 border-green-200'
          }`}>
            {ptoData?.ptoType || 'PTO'}
          </Badge>
          
          {/* Show position for partial PTO */}
          {isPartialPTO && displayPosition && (
            <div className="text-xs text-muted-foreground mt-1 truncate">
              {displayPosition}
            </div>
          )}
          
          {/* Show "Partial Day" indicator for partial PTO */}
          {isPartialPTO && (
            <div className="text-xs text-green-600 font-medium mt-1">
              Partial Day
            </div>
          )}
        </div>
      ) : (
        <div className="text-center">
          {/* Show "Extra Shift" for true extra days */}
          {isExtraShift && (
            <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200 mb-1">
              Extra Shift
            </Badge>
          )}
          {/* Show "Special Assignment" badge only for actual special assignments */}
          {isSpecialAssignment && !isExtraShift && (
            <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200 mb-1">
              Special
            </Badge>
          )}
          {displayPosition && (
            <div className="text-sm font-medium truncate">
              {displayPosition}
            </div>
          )}
        </div>
      )}

      {/* Action buttons for admin/supervisor - Only show on hover */}
      {isAdminOrSupervisor && officer.shiftInfo && (
        <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          {/* PENCIL ICON - Edit Assignment */}
          {!isOff && (
            <Button
              size="icon"
              variant="secondary"
              className="h-6 w-6 bg-blue-100 hover:bg-blue-200 text-blue-700 border border-blue-200 shadow-sm"
              onClick={(e) => {
                e.stopPropagation();
                onEditAssignment(officer, dateStr);
              }}
              title="Edit Assignment"
            >
              <Edit2 className="h-3 w-3" />
            </Button>
          )}
          
          {/* DELETE BUTTON - Only show for extra shifts */}
          {isExtraShift && (
            <Button
              size="icon"
              variant="secondary"
              className="h-6 w-6 bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 shadow-sm"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveOfficer(officer);
              }}
              disabled={isUpdating}
              title="Remove Extra Shift"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
          
          {/* CLOCK ICON - PTO Management */}
          {!isOff && (
            <Button
              size="icon"
              variant="secondary"
              className="h-6 w-6 bg-green-100 hover:bg-green-200 text-green-700 border border-green-200 shadow-sm"
              onClick={(e) => {
                e.stopPropagation();
                onAssignPTO(officer.shiftInfo, dateStr, officerId, officerName);
              }}
              title={hasPTO ? "Edit PTO" : "Assign PTO"}
            >
              <Clock className="h-3 w-3" />
            </Button>
          )}
          
          {/* TRASH ICON - Remove PTO */}
          {hasPTO && (
            <Button
              size="icon"
              variant="secondary"
              className="h-6 w-6 bg-orange-100 hover:bg-orange-200 text-orange-700 border border-orange-200 shadow-sm"
              onClick={(e) => {
                e.stopPropagation();
                onRemovePTO(officer.shiftInfo, dateStr, officerId);
              }}
              disabled={isUpdating}
              title="Remove PTO"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
