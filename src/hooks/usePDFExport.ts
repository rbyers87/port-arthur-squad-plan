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

      // Store original styles
      const originalOverflow = element.style.overflow;
      const originalHeight = element.style.height;
      const originalMaxHeight = element.style.maxHeight;
      
      // Temporarily adjust element for better capture
      element.style.overflow = 'visible';
      element.style.height = 'auto';
      element.style.maxHeight = 'none';

      // Fix all nested elements that might be clipped
      const badges = element.querySelectorAll('[class*="badge"], [class*="Badge"]');
      const originalBadgeStyles: Array<{ el: HTMLElement; styles: { [key: string]: string } }> = [];
      
      badges.forEach((badge) => {
        const el = badge as HTMLElement;
        const original = {
          el,
          styles: {
            overflow: el.style.overflow,
            whiteSpace: el.style.whiteSpace,
            textOverflow: el.style.textOverflow,
            display: el.style.display,
            width: el.style.width,
            maxWidth: el.style.maxWidth,
          }
        };
        originalBadgeStyles.push(original);
        
        // Force badges to display fully
        el.style.overflow = 'visible';
        el.style.whiteSpace = 'nowrap';
        el.style.textOverflow = 'clip';
        el.style.display = 'inline-flex';
        el.style.width = 'auto';
        el.style.maxWidth = 'none';
      });

      // Wait for layout to stabilize
      await new Promise(resolve => setTimeout(resolve, 200));

      // Capture the element as canvas with better quality settings
      const canvas = await html2canvas(element, {
        scale: 3, // Even higher quality
        logging: false,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
        windowWidth: element.scrollWidth + 100, // Extra padding
        windowHeight: element.scrollHeight + 100,
        scrollY: -window.scrollY,
        scrollX: -window.scrollX,
        // Ensure everything is captured fully
        onclone: (clonedDoc) => {
          const clonedElement = clonedDoc.getElementById(elementId);
          if (clonedElement) {
            clonedElement.style.overflow = 'visible';
            clonedElement.style.height = 'auto';
            clonedElement.style.maxHeight = 'none';
            
            // Fix all elements in the cloned document
            const allElements = clonedElement.getElementsByTagName('*');
            for (let i = 0; i < allElements.length; i++) {
              const el = allElements[i] as HTMLElement;
              el.style.overflow = 'visible';
              el.style.maxWidth = 'none';
              el.style.textOverflow = 'clip';
              
              // Special handling for flex containers
              if (el.classList.contains('flex') || 
                  el.style.display === 'flex' || 
                  el.style.display === 'inline-flex') {
                el.style.flexWrap = 'wrap';
              }
            }
          }
        }
      });

      // Restore original styles
      element.style.overflow = originalOverflow;
      element.style.height = originalHeight;
      element.style.maxHeight = originalMaxHeight;
      
      // Restore badge styles
      originalBadgeStyles.forEach(({ el, styles }) => {
        Object.keys(styles).forEach(key => {
          el.style[key as any] = styles[key];
        });
      });

      // Calculate dimensions for PDF (A4 landscape for better fit)
      const pdf = new jsPDF("l", "mm", "a4"); // landscape orientation
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      const imgWidth = pdfWidth - 20; // 10mm margin on each side
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      const imgData = canvas.toDataURL("image/png", 1.0);

      // Add header with date
      pdf.setFontSize(16);
      pdf.setFont(undefined, 'bold');
      const headerText = `${shiftName} - ${format(selectedDate, "EEEE, MMMM d, yyyy")}`;
      const textWidth = pdf.getTextWidth(headerText);
      pdf.text(headerText, (pdfWidth - textWidth) / 2, 15);

      // Add the schedule image
      let yPosition = 25;
      let heightLeft = imgHeight;

      // First page
      if (heightLeft <= pdfHeight - 30) {
        // Fits on one page
        pdf.addImage(imgData, "PNG", 10, yPosition, imgWidth, imgHeight);
      } else {
        // Multiple pages needed
        let currentHeight = 0;
        while (heightLeft > 0) {
          const pageImgHeight = Math.min(pdfHeight - 30, heightLeft);
          
          // Crop the canvas for this page
          const pageCanvas = document.createElement('canvas');
          pageCanvas.width = canvas.width;
          pageCanvas.height = (pageImgHeight / imgWidth) * canvas.width;
          
          const ctx = pageCanvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(
              canvas,
              0, currentHeight * (canvas.width / imgWidth),
              canvas.width, pageCanvas.height,
              0, 0,
              canvas.width, pageCanvas.height
            );
            
            const pageImgData = pageCanvas.toDataURL("image/png", 1.0);
            
            if (currentHeight > 0) {
              pdf.addPage();
            }
            
            pdf.addImage(pageImgData, "PNG", 10, 25, imgWidth, pageImgHeight);
          }
          
          currentHeight += pageImgHeight;
          heightLeft -= pageImgHeight;
        }
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