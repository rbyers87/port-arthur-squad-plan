// hooks/usePDFExport.ts
import { useCallback } from "react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { format } from "date-fns";

interface ExportOptions {
  selectedDate: Date;
  shiftName: string;
  elementId: string;
}

export const usePDFExport = () => {
  const exportToPDF = useCallback(async ({ selectedDate, shiftName, elementId }: ExportOptions) => {
    try {
      // Find the element to export
      const element = document.getElementById(elementId);
      if (!element) {
        throw new Error("Schedule element not found");
      }

      // Show loading state (you can add a toast here)
      console.log("Generating PDF...");

      // Capture the element as canvas
      const canvas = await html2canvas(element, {
        scale: 2, // Higher quality
        logging: false,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      // Calculate dimensions
      const imgWidth = 210; // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;

      // Create PDF
      const pdf = new jsPDF("p", "mm", "a4");
      let position = 0;

      // Add image to PDF (handle multiple pages if needed)
      const imgData = canvas.toDataURL("image/png");
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      // Generate filename
      const dateStr = format(selectedDate, "yyyy-MM-dd");
      const filename = `schedule_${shiftName.replace(/\s+/g, "_")}_${dateStr}.pdf`;

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
