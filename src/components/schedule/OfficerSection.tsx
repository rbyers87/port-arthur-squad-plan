// src/components/schedule/OfficerSection.tsx
import { Badge } from "@/components/ui/badge";
import { OfficerCard } from "./OfficerCard";
import { PTOCard } from "./PTOCard";
import { PartnershipManager } from "./PartnershipManager"; // We'll create this

interface OfficerSectionProps {
  title: string;
  officers?: any[];
  ptoRecords?: any[];
  minCount?: number;
  currentCount?: number;
  isUnderstaffed?: boolean;
  canEdit: boolean;
  onSavePosition: (officer: any, position: string) => void;
  onSaveUnitNumber: (officer: any, unitNumber: string) => void;
  onSaveNotes: (officer: any, notes: string) => void;
  onAssignPTO: (officer: any) => void;
  onRemoveOfficer?: (officer: any) => void;
  onEditPTO?: (ptoRecord: any) => void;
  onRemovePTO?: (ptoRecord: any) => void;
  onPartnershipChange?: (officer: any, partnerOfficerId?: string) => void; // Add partnership handler
  isUpdating?: boolean;
  sectionType?: "regular" | "special" | "pto";
}

export const OfficerSection = ({
  title,
  officers = [],
  ptoRecords = [],
  minCount,
  currentCount,
  isUnderstaffed,
  canEdit,
  onSavePosition,
  onSaveUnitNumber,
  onSaveNotes,
  onAssignPTO,
  onRemoveOfficer,
  onEditPTO,
  onRemovePTO,
  onPartnershipChange, // Add partnership handler
  isUpdating = false,
  sectionType = "regular"
}: OfficerSectionProps) => {
  const isPTOSection = sectionType === "pto";
  const hasData = isPTOSection ? ptoRecords.length > 0 : officers.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between border-b pb-2">
        <h4 className="font-semibold text-sm">{title}</h4>
        {minCount !== undefined && currentCount !== undefined ? (
          <Badge variant={isUnderstaffed ? "destructive" : "outline"}>
            {currentCount} / {minCount}
          </Badge>
        ) : (
          <Badge variant="outline">
            {isPTOSection ? ptoRecords.length : officers.length}
          </Badge>
        )}
      </div>
      
      {!hasData ? (
        <p className="text-sm text-muted-foreground italic">
          No {title.toLowerCase()} scheduled
        </p>
      ) : isPTOSection ? (
        ptoRecords.map((ptoRecord) => (
          <PTOCard
            key={ptoRecord.id}
            ptoRecord={ptoRecord}
            canEdit={canEdit}
            onSaveUnitNumber={(record, unit) => onSaveUnitNumber(record, unit)}
            onSaveNotes={(record, notes) => onSaveNotes(record, notes)}
            onEdit={onEditPTO!}
            onRemove={onRemovePTO!}
            isUpdating={isUpdating}
          />
        ))
      ) : (
        officers
          .map((officer) => (
            <OfficerCard
              key={`${officer.scheduleId}-${officer.type}`}
              officer={officer}
              canEdit={canEdit}
              onSavePosition={onSavePosition}
              onSaveUnitNumber={(off, unit) => onSaveUnitNumber(off, unit)}
              onSaveNotes={(off, notes) => onSaveNotes(off, notes)}
              onAssignPTO={onAssignPTO}
              onRemove={onRemoveOfficer}
              onPartnershipChange={onPartnershipChange} // Pass partnership handler
              isUpdating={isUpdating}
              sectionType={sectionType}
            />
          ))
          .filter(Boolean)
      )}
    </div>
  );
};
