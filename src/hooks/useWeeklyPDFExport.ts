// src/hooks/useWeeklyPDFExport.ts
import { format, startOfWeek, addDays, addWeeks, parseISO } from "date-fns";
import { getLastName } from "@/utils/scheduleUtils";

interface ExportOptions {
  startDate: Date;
  endDate: Date;
  shiftName: string;
  scheduleData: any[];
}

export const useWeeklyPDFExport = () => {
  const exportWeeklyPDF = async ({
    startDate,
    endDate,
    shiftName,
    scheduleData,
  }: ExportOptions) => {
    try {
      // ✅ Lazy-load jsPDF so it doesn't slow page load
      const { default: jsPDF } = await import("jspdf");
      const pdf = new jsPDF("landscape", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      let yPosition = 20;

      // ===== Header =====
      pdf.setFontSize(16);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(41, 128, 185);
      pdf.text(
        `WEEKLY SCHEDULE - ${shiftName.toUpperCase()}`,
        pageWidth / 2,
        yPosition,
        { align: "center" }
      );

      yPosition += 8;
      pdf.setFontSize(10);
      pdf.setTextColor(100, 100, 100);
      pdf.text(
        `Period: ${format(startDate, "MMM d, yyyy")} - ${format(
          endDate,
          "MMM d, yyyy"
        )}`,
        pageWidth / 2,
        yPosition,
        { align: "center" }
      );
      yPosition += 15;

      // ===== Build weeks =====
      const weeks = [];
      let currentWeekStart = startOfWeek(startDate, { weekStartsOn: 0 });
      while (currentWeekStart <= endDate) {
        weeks.push({ start: currentWeekStart, end: addDays(currentWeekStart, 6) });
        currentWeekStart = addWeeks(currentWeekStart, 1);
      }

      // ===== Render each week =====
      for (const week of weeks) {
        if (yPosition > pdf.internal.pageSize.getHeight() - 50) {
          pdf.addPage();
          yPosition = 20;
        }

        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text(
          `Week of ${format(week.start, "MMM d")} - ${format(week.end, "MMM d, yyyy")}`,
          15,
          yPosition
        );
        yPosition += 8;

        const weekDays = Array.from({ length: 7 }, (_, i) => {
          const date = addDays(week.start, i);
          return {
            dateStr: format(date, "yyyy-MM-dd"),
            dayName: format(date, "EEE").toUpperCase(),
            formattedDate: format(date, "MMM d"),
          };
        });

        const colWidths = [25, 35];
        const dayColWidth = (pageWidth - 60 - colWidths[0] - colWidths[1]) / 7;

        let xPosition = 15;
        pdf.setFillColor(41, 128, 185);
        pdf.setFontSize(8);
        pdf.setTextColor(255, 255, 255);

        // Static headers
        pdf.rect(xPosition, yPosition, colWidths[0], 8, "F");
        pdf.text("BADGE", xPosition + 2, yPosition + 5);
        xPosition += colWidths[0];
        pdf.rect(xPosition, yPosition, colWidths[1], 8, "F");
        pdf.text("NAME", xPosition + 2, yPosition + 5);
        xPosition += colWidths[1];

        // Day headers
        weekDays.forEach((day) => {
          pdf.rect(xPosition, yPosition, dayColWidth, 8, "F");
          pdf.text(day.dayName, xPosition + 2, yPosition + 3);
          pdf.text(day.formattedDate, xPosition + 2, yPosition + 6);
          xPosition += dayColWidth;
        });

        yPosition += 8;

        // ===== Officer rows =====
        const allOfficers = new Map();
        scheduleData?.forEach((daySchedule) => {
          const scheduleDate = parseISO(daySchedule.date);
          if (scheduleDate >= week.start && scheduleDate <= week.end) {
            daySchedule.officers.forEach((officer: any) => {
              if (!allOfficers.has(officer.officerId)) {
                allOfficers.set(officer.officerId, {
                  ...officer,
                  weeklySchedule: {},
                });
              }
              allOfficers.get(officer.officerId).weeklySchedule[daySchedule.date] =
                officer;
            });
          }
        });

        pdf.setFontSize(7);
        pdf.setTextColor(0, 0, 0);

        for (const officer of allOfficers.values()) {
          if (yPosition > pdf.internal.pageSize.getHeight() - 15) {
            pdf.addPage();
            yPosition = 20;
          }

          xPosition = 15;
          pdf.text(officer.badgeNumber?.toString() || "", xPosition + 2, yPosition + 4);
          xPosition += colWidths[0];
          pdf.text(getLastName(officer.officerName), xPosition + 2, yPosition + 4);
          xPosition += colWidths[1];

          weekDays.forEach((day) => {
            const dayOfficer = officer.weeklySchedule[day.dateStr];
            let text = "";
            let color: [number, number, number] = [0, 0, 0];

            if (dayOfficer) {
              if (dayOfficer.shiftInfo?.isOff) {
                text = "OFF";
                color = [100, 100, 100];
              } else if (dayOfficer.shiftInfo?.hasPTO) {
                text = "PTO";
                color = [220, 38, 38];
              } else if (dayOfficer.shiftInfo?.position) {
                text = dayOfficer.shiftInfo.position.substring(0, 8);
                color = [0, 100, 0];
              } else {
                text = "SCHED";
                color = [0, 0, 150];
              }
            }

            pdf.setTextColor(...color);
            pdf.text(text, xPosition + 2, yPosition + 4);
            xPosition += dayColWidth;
          });

          yPosition += 6;
        }

        yPosition += 10;
      }

      // ===== Footer =====
      pdf.setFontSize(8);
      pdf.setTextColor(100, 100, 100);
      pdf.text(
        `Generated on ${format(new Date(), "MMM d, yyyy 'at' h:mm a")}`,
        pageWidth / 2,
        pdf.internal.pageSize.getHeight() - 10,
        { align: "center" }
      );

      const filename = `Weekly_Schedule_${shiftName.replace(/\s+/g, "_")}_${format(
        startDate,
        "yyyy-MM-dd"
      )}_to_${format(endDate, "yyyy-MM-dd")}.pdf`;
      pdf.save(filename);

      return { success: true };
    } catch (error) {
      console.error("PDF export error:", error);
      return { success: false, error };
    }
  };

  return { exportWeeklyPDF };
};
