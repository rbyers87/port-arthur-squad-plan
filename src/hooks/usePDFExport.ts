// hooks/usePDFExport.ts
import { useCallback } from "react";
import jsPDF from "jspdf";
import { format } from "date-fns";

interface ExportOptions {
  selectedDate: Date;
  shiftName: string;
  shiftData: any;
}

// Modern color scheme
const COLORS = {
  primary: [41, 128, 185],    // Blue
  secondary: [52, 152, 219],  // Light Blue
  accent: [155, 89, 182],     // Purple
  success: [39, 174, 96],     // Green
  warning: [243, 156, 18],    // Orange
  danger: [231, 76, 60],      // Red
  light: [248, 249, 250],     // Very Light Gray
  dark: [44, 62, 80],         // Dark Blue
  gray: [108, 117, 125],      // Medium Gray
  border: [222, 226, 230]     // Border Gray
};

// Convert image to base64 (you'll need to do this for your logo)
const getLogoBase64 = async (): Promise<string> => {
  try {
    const response = await fetch('/logo.png'); // Adjust path to your logo
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Failed to load logo:', error);
    return ''; // Fallback to no logo
  }
};

// Draw actual logo function
const drawActualLogo = (pdf: jsPDF, x: number, y: number, logoBase64: string) => {
  if (!logoBase64) {
    // Fallback to placeholder if logo fails to load
    const logoSize = 20;
    pdf.setFillColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
    pdf.rect(x, y, logoSize, logoSize, 'F');
    pdf.setFontSize(6);
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.text("LOGO", x + logoSize/2, y + logoSize/2, { align: 'center', baseline: 'middle' });
    return logoSize;
  }

  try {
    const logoWidth = 20;
    const logoHeight = 20;
    pdf.addImage(logoBase64, 'PNG', x, y, logoWidth, logoHeight);
    return logoWidth;
  } catch (error) {
    console.error('Error drawing logo:', error);
    // Fallback to placeholder
    const logoSize = 20;
    pdf.setFillColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
    pdf.rect(x, y, logoSize, logoSize, 'F');
    pdf.setFontSize(6);
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.text("LOGO", x + logoSize/2, y + logoSize/2, { align: 'center', baseline: 'middle' });
    return logoSize;
  }
};

// Fixed table drawing function - expands to full width
const drawCompactTable = (pdf: jsPDF, headers: string[], data: any[][], startY: number, margins: { left: number, right: number }, sectionColor?: number[]) => {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const tableWidth = pageWidth - margins.left - margins.right;
  
  // Fixed column widths that use the full table width
  const getColumnWidths = (headers: string[]) => {
    const totalColumns = headers.length;
    const baseWidths = {
      "OFFICER NAME": 0.35,    // 35% of table width
      "BEAT": 0.15,            // 15% of table width
      "ASSIGNMENT": 0.20,      // 20% of table width
      "BADGE #": 0.15,         // 15% of table width
      "UNIT": 0.10,            // 10% of table width
      "NOTES": 0.25,           // 25% of table width
      "TYPE": 0.15,            // 15% of table width
      "TIME": 0.20             // 20% of table width
    };

    return headers.map(header => {
      const widthPercentage = baseWidths[header as keyof typeof baseWidths] || (1 / totalColumns);
      return tableWidth * widthPercentage;
    });
  };

  const colWidths = getColumnWidths(headers);
  
  // Verify total width matches table width (adjust if needed due to rounding)
  const totalWidth = colWidths.reduce((sum, width) => sum + width, 0);
  if (Math.abs(totalWidth - tableWidth) > 1) {
    const adjustmentFactor = tableWidth / totalWidth;
    colWidths.forEach((width, index) => {
      colWidths[index] = width * adjustmentFactor;
    });
  }

  let y = startY;
  const rowHeight = 8;
  const cellPadding = 3;

  // Draw headers - full width
  let x = margins.left;
  headers.forEach((header, index) => {
    pdf.setFillColor(sectionColor?.[0] || COLORS.primary[0], sectionColor?.[1] || COLORS.primary[1], sectionColor?.[2] || COLORS.primary[2]);
    pdf.rect(x, y, colWidths[index], rowHeight, 'F');
    
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    pdf.setTextColor(255, 255, 255);
    
    // Center text in header cells
    const textWidth = pdf.getTextWidth(header);
    const textX = x + (colWidths[index] - textWidth) / 2;
    pdf.text(header, Math.max(textX, x + 2), y + rowHeight - cellPadding);
    
    x += colWidths[index];
  });

  y += rowHeight;

  // Draw data rows - full width
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  
  data.forEach((row, rowIndex) => {
    x = margins.left;
    
    // Alternate row colors
    if (rowIndex % 2 === 0) {
      pdf.setFillColor(255, 255, 255);
    } else {
      pdf.setFillColor(COLORS.light[0], COLORS.light[1], COLORS.light[2]);
    }
    
    // Fill entire row background
    pdf.rect(x, y, tableWidth, rowHeight, 'F');
    
    // Light borders
    pdf.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
    pdf.setLineWidth(0.1);
    
    row.forEach((cell, cellIndex) => {
      // Draw cell border
      pdf.rect(x, y, colWidths[cellIndex], rowHeight, 'S');
      
      // Cell content
      pdf.setTextColor(COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]);
      
      const cellText = cell?.toString() || "";
      const maxTextWidth = colWidths[cellIndex] - (cellPadding * 2);
      
      let displayText = cellText;
      if (pdf.getTextWidth(cellText) > maxTextWidth) {
        // Truncate text that's too long
        let truncated = cellText;
        while (pdf.getTextWidth(truncated + "...") > maxTextWidth && truncated.length > 1) {
          truncated = truncated.substring(0, truncated.length - 1);
        }
        displayText = truncated + (truncated.length < cellText.length ? "..." : "");
      }
      
      pdf.text(displayText, x + cellPadding, y + rowHeight - cellPadding);
      x += colWidths[cellIndex];
    });
    
    y += rowHeight;
    
    // Check if we need a new page
    if (y > pdf.internal.pageSize.getHeight() - 30) {
      pdf.addPage();
      y = 30;
      
      // Redraw headers on new page
      x = margins.left;
      headers.forEach((header, index) => {
        pdf.setFillColor(sectionColor?.[0] || COLORS.primary[0], sectionColor?.[1] || COLORS.primary[1], sectionColor?.[2] || COLORS.primary[2]);
        pdf.rect(x, y, colWidths[index], rowHeight, 'F');
        
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(7);
        pdf.setTextColor(255, 255, 255);
        
        const textWidth = pdf.getTextWidth(header);
        const textX = x + (colWidths[index] - textWidth) / 2;
        pdf.text(header, Math.max(textX, x + 2), y + rowHeight - cellPadding);
        
        x += colWidths[index];
      });
      y += rowHeight;
    }
  });

  return y + 8;
};

export const usePDFExport = () => {
  const exportToPDF = useCallback(async ({ selectedDate, shiftName, shiftData }: ExportOptions) => {
    try {
      console.log("PDF Export - Received data:", { selectedDate, shiftName, shiftData });

      if (!shiftData || !selectedDate) {
        throw new Error("No shift data or date provided for PDF export");
      }

      // Load logo first
      const logoBase64 = await getLogoBase64();

      // Create PDF in portrait orientation
      const pdf = new jsPDF("p", "mm", "letter");
      const pageWidth = pdf.internal.pageSize.getWidth();
      let yPosition = 20;

      // Draw actual logo
      drawActualLogo(pdf, 15, 15, logoBase64);

      // Compact header section
      pdf.setFillColor(COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]);
      pdf.rect(40, 15, pageWidth - 55, 20, 'F');
      
      // Organization header - smaller font
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(255, 255, 255);
      pdf.text("PAPD FIELD OPERATIONS", 45, 25);
      
      pdf.setFontSize(10);
      pdf.text("DAILY SCHEDULE", 45, 31);

      // Compact shift info
      yPosition = 42;
      
      pdf.setFillColor(COLORS.light[0], COLORS.light[1], COLORS.light[2]);
      pdf.roundedRect(15, yPosition, pageWidth - 30, 12, 2, 2, 'F');
      
      pdf.setFontSize(8);
      pdf.setTextColor(COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]);
      pdf.setFont("helvetica", "bold");
      
      const dateText = `${format(selectedDate, "EEE, MMM d, yyyy")} • ${shiftName.toUpperCase()} • ${shiftData.shift?.start_time || "N/A"}-${shiftData.shift?.end_time || "N/A"}`;
      pdf.text(dateText, 20, yPosition + 7);

      yPosition += 18;

      // Supervisors - compact display
      if (shiftData.supervisors && shiftData.supervisors.length > 0) {
        pdf.setFontSize(7);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]);
        pdf.text("SUPERVISORS:", 15, yPosition);
        
        yPosition += 4;

        // Supervisors in a compact row
        const supervisorNames = shiftData.supervisors.map((supervisor: any) => {
          const name = supervisor?.name ? supervisor.name.toUpperCase() : "UNKNOWN";
          const unit = supervisor?.unitNumber ? `(Unit ${supervisor.unitNumber})` : "";
          return `${name} ${unit}`;
        }).join(" • ");
        
        pdf.setFont("helvetica", "normal");
        pdf.text(supervisorNames, 15, yPosition);
        
        yPosition += 8;
      }

      // SECTION 1: REGULAR OFFICERS TABLE - Full width
      const regularOfficersData: any[] = [];
      
      if (shiftData.officers && shiftData.officers.length > 0) {
        shiftData.officers.forEach((officer: any) => {
          regularOfficersData.push([
            officer?.name ? officer.name.toUpperCase() : "UNKNOWN",
            officer?.position || "",
            officer?.badge || "",
            officer?.unitNumber || "",
            officer?.notes || officer?.customTime || ""
          ]);
        });

        const officersHeaders = ["OFFICER NAME", "BEAT", "BADGE #", "UNIT", "NOTES"];
        yPosition = drawCompactTable(pdf, officersHeaders, regularOfficersData, yPosition, { left: 15, right: 15 }, COLORS.primary);
      }

      // SECTION 2: SPECIAL ASSIGNMENT OFFICERS TABLE - Full width
      const specialAssignmentData: any[] = [];
      
      if (shiftData.specialAssignmentOfficers && shiftData.specialAssignmentOfficers.length > 0) {
        shiftData.specialAssignmentOfficers.forEach((officer: any) => {
          specialAssignmentData.push([
            officer?.name ? officer.name.toUpperCase() : "UNKNOWN",
            officer?.position || "Special",
            officer?.badge || "",
            officer?.unitNumber || "",
            officer?.notes || officer?.customTime || ""
          ]);
        });

        const specialHeaders = ["OFFICER NAME", "ASSIGNMENT", "BADGE #", "UNIT", "NOTES"];
        yPosition = drawCompactTable(pdf, specialHeaders, specialAssignmentData, yPosition, { left: 15, right: 15 }, COLORS.accent);
      }

      // SECTION 3: PTO/OFF DUTY TABLE - Full width
      if (shiftData.ptoRecords && shiftData.ptoRecords.length > 0) {
        const ptoData: any[] = [];
        
        shiftData.ptoRecords.forEach((record: any) => {
          const name = record?.name ? record.name.toUpperCase() : "UNKNOWN";
          const badge = record?.badge || "";
          const ptoType = record?.ptoType ? record.ptoType.toUpperCase() : "UNKNOWN";
          
          const timeInfo = record?.isFullShift 
            ? "FULL SHIFT" 
            : `${record?.startTime || "N/A"}-${record?.endTime || "N/A"}`;
          
          ptoData.push([name, badge, ptoType, timeInfo]);
        });

        const ptoHeaders = ["OFFICER NAME", "BADGE #", "TYPE", "TIME"];
        yPosition = drawCompactTable(pdf, ptoHeaders, ptoData, yPosition, { left: 15, right: 15 }, COLORS.warning);
      }

      // Compact staffing summary at bottom
      yPosition += 5;
      const currentSupervisors = shiftData.currentSupervisors || 0;
      const minSupervisors = shiftData.minSupervisors || 0;
      const currentOfficers = shiftData.currentOfficers || 0;
      const minOfficers = shiftData.minOfficers || 0;
      
      pdf.setFontSize(7);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]);
      
      const staffingText = `STAFFING: Supervisors ${currentSupervisors}/${minSupervisors} • Officers ${currentOfficers}/${minOfficers}`;
      pdf.text(staffingText, 15, yPosition);

      // Compact footer reminders
      yPosition += 8;
      const reminders = [
        " Check Email •  Complete Paperwork •  Tag Video •  Clock In/Out"
      ];

      pdf.setFontSize(6);
      pdf.setTextColor(COLORS.gray[0], COLORS.gray[1], COLORS.gray[2]);
      reminders.forEach((reminder) => {
        pdf.text(reminder, 15, yPosition);
        yPosition += 3;
      });

      // Generated timestamp
      const generatedAt = `Generated: ${format(new Date(), "MMM d, h:mm a")}`;
      pdf.text(generatedAt, pageWidth - 15, yPosition, { align: 'right' });

      // Generate filename
      const dateStr = format(selectedDate, "yyyy-MM-dd");
      const dayOfWeek = format(selectedDate, "EEEE").toUpperCase();
      const filename = `PAPD_Schedule_${shiftName.replace(/\s+/g, "_")}_${dayOfWeek}_${dateStr}.pdf`;

      // Save the PDF
      pdf.save(filename);

      return { success: true };
    } catch (error) {
      console.error("PDF export error:", error);
      return { success: false, error };
    }
  }, []);

  return { exportToPDF };
};