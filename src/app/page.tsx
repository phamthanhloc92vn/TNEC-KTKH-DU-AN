"use client";
export const dynamic = "force-dynamic";

import { useState } from "react";
import { Settings } from "lucide-react";
import UploadPanel from "./components/UploadPanel";
import ResultsPanel from "./components/ResultsPanel";
import SettingsModal from "./components/SettingsModal";


interface CongVanData {
  "Loại công văn": string;
  "Số văn bản": string;
  "Ngày văn bản": string;
  "Tóm nội dung chính": string;
  "Đơn vị gửi đến": string;
  "Người nhận": string;
  "Ngày/Tháng": string;
  "Tên File CV": string;
}

// Normalize Vietnamese text date → DD/MM/YYYY
function normalizeDate(raw: string): string {
  if (!raw || raw === "N/A") return raw;

  // Handle AI literally returning the placeholder string from prompt
  if (raw.includes("DD/MM/YYYY") || raw.includes("DD/MM/2026")) return "N/A";

  // Already in DD/MM/YYYY format
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw.trim())) return raw.trim();

  // D/M/YYYY or D/M/YY
  const slashMatch = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})/);
  if (slashMatch) {
    const d = slashMatch[1].padStart(2, "0");
    const m = slashMatch[2].padStart(2, "0");
    const y = slashMatch[3].length === 2 ? "20" + slashMatch[3] : slashMatch[3];
    return `${d}/${m}/${y}`;
  }

  // "ngày X tháng Y năm Z" or "Tháng Y năm Z"
  const viMatch = raw.match(/(?:ng[àa]y\s+(\d{1,2})\s+)?[Tt]h[àa]ng\s+(\d{1,2})\s+[Nn]ă[mn]\s+(\d{4})/);
  if (viMatch) {
    const d = viMatch[1] ? viMatch[1].padStart(2, "0") : "01";
    const m = viMatch[2].padStart(2, "0");
    const y = viMatch[3];
    return `${d}/${m}/${y}`;
  }

  // "tháng 03 năm 2025" without "ngày"
  const monthYear = raw.match(/[Tt]h[àa]ng\s+(\d{1,2})[,\s]+[Nn]ă[mn]\s+(\d{4})/);
  if (monthYear) {
    return `${monthYear[1].padStart(2, "0")}/${monthYear[2]}`;
  }

  return raw; // return as-is if cannot parse
}

export default function Home() {
  const [status, setStatus] = useState<"IDLE" | "PROCESSING" | "SUCCESS">("IDLE");
  const [processingText, setProcessingText] = useState("");
  const [extractedData, setExtractedData] = useState<CongVanData[]>([]);
  const [validationScores, setValidationScores] = useState<Record<string, number>[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [fileUrls, setFileUrls] = useState<string[]>([]);
  const [selectedPdfIndex, setSelectedPdfIndex] = useState(0);
  const [syncStatus, setSyncStatus] = useState<"IDLE" | "SYNCING" | "SUCCESS">("IDLE");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleUpload = async (files: File[]) => {
    const savedSettings = localStorage.getItem("contract_ai_settings");
    if (!savedSettings) {
      alert("Please configure your OpenAI API Key in Settings first.");
      setIsSettingsOpen(true);
      return;
    }
    const settings = JSON.parse(savedSettings);
    console.log(`⚙️ Settings loaded — scriptUrl: ${settings.scriptUrl ? 'OK' : 'EMPTY'}`);
    if (!settings.apiKey) {
      alert("Please provide an OpenAI API Key in Settings.");
      setIsSettingsOpen(true);
      return;
    }

    setStatus("PROCESSING");
    const newData: CongVanData[] = [...extractedData];
    const newScores: Record<string, number>[] = [...validationScores];
    const newPreviews: string[] = [...previews];
    const newFileUrls: string[] = [...fileUrls];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProcessingText(`Đang xử lý file ${i + 1}/${files.length} (${file.name})...`);

      try {
        // Store original file URL for viewing
        const fileUrl = URL.createObjectURL(file);
        newFileUrls.push(fileUrl);
        setFileUrls([...newFileUrls]);

        // 1. Convert PDF to images via CDN pdf.js (bypassing Next.js worker issues)
        setProcessingText(`Đang xử lý hình ảnh PDF...`);
        const pageImages: string[] = [];
        let previewBase64 = "";

        try {
          // get pdfjsLib from global window, injected via next/script in layout
          const pdfjsLib = (window as any).pdfjsLib;
          if (!pdfjsLib) throw new Error("pdf.js not loaded from CDN");

          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({
            data: arrayBuffer,
            disableFontFace: true,   // prevent font crashes
            useSystemFonts: true,
          }).promise;

          const pagesToScan = Math.min(pdf.numPages, 8); // Quét tối đa 8 trang đầu
          console.log(`📄 PDF loaded: ${pagesToScan} trang`);

          for (let p = 1; p <= pagesToScan; p++) {
            const page = await pdf.getPage(p);
            const viewport = page.getViewport({ scale: 2.0 }); // Scale 2.0 cho OCR nét rực rỡ
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            if (ctx) {
              await page.render({ canvasContext: ctx, viewport: viewport }).promise;
              const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
              pageImages.push(dataUrl);
              if (p === 1) previewBase64 = dataUrl;
            }
          }
        } catch (pdfErr) {
          console.error("❌ Lỗi render PDF sang ảnh:", pdfErr);
        }

        // Preview
        newPreviews.push(previewBase64);
        setPreviews([...newPreviews]);

        // 2. Prepare Form Data
        setProcessingText(`Đang gửi lên AI để phân tích...`);
        const formData = new FormData();
        formData.append("file", file);
        if (pageImages.length > 0) {
          pageImages.forEach((img, idx) => {
            formData.append(`image_page_${idx + 1}`, img);
          });
          formData.append("total_pages_sent", String(pageImages.length));
          console.log(`📤 Gửi ${pageImages.length} ảnh lên AI`);
        } else {
          // Fallback to sending base64 PDF directly if rendering somehow failed
          const pdfBase64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
          formData.append("pdf_base64", pdfBase64);
          console.warn("⚠️ Canvas failed. Fallback to sending raw PDF base64.");
        }



        const response = await fetch("/api/extract-contract", {
          method: "POST",
          headers: {
            "x-api-key": settings.apiKey,
            "x-model": settings.model || "gpt-4o"
          },
          body: formData
        });

        const responseText = await response.text();
        let result;
        try {
          result = JSON.parse(responseText || "{}");
        } catch (e) {
          throw new Error(`API Error (HTTP ${response.status}): The server did not return valid JSON.`);
        }

        if (!response.ok) {
          throw new Error(result.error || `Server error ${response.status}`);
        }

        // Normalize "Ngày văn bản" — convert text dates to DD/MM/YYYY
        if (result.data?.["Ngày văn bản"]) {
          result.data["Ngày văn bản"] = normalizeDate(result.data["Ngày văn bản"]);
        }
        // Inject today's date as "Ngày/Tháng" (upload date)
        const today = new Date();
        result.data["Ngày/Tháng"] = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
        // Inject filename
        result.data["Tên File CV"] = file.name;

        newData.push(result.data);
        newScores.push(result.validationScores || {});


        setExtractedData([...newData]);
        setValidationScores([...newScores]);

        // 3. Auto-Sync to Google Sheets
        const scriptUrl = settings.scriptUrl || "";
        if (scriptUrl) {
          setProcessingText(`Đang đồng bộ "${result.data?.["Loại công văn"] || "N/A"}" lên Google Sheets...`);
          try {
            const payload = buildSheetsPayload(result.data);
            console.log(`📤 Sync [${i + 1}/${files.length}] "${payload["Loại công văn"]}"`);
            const syncResp = await fetch("/api/sync-sheets", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ scriptUrl, payload }),
            });
            const syncResult = await syncResp.json();
            console.log(`✅ Sync [${i + 1}]:`, syncResult);
            // Delay 1s giữa các sync để tránh rate limit
            if (i < files.length - 1) await new Promise(r => setTimeout(r, 500));
          } catch (syncError) {
            console.error(`❌ Sync failed [${i + 1}]:`, syncError);
          }
        } else {
          console.warn("⚠️ Chưa cấu hình Google Apps Script URL trong Settings.");
        }

      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        alert(`Lỗi xử lý file "${file.name}": ${msg}`);
      }
    }

    setStatus("SUCCESS");
    setSyncStatus("SUCCESS");
    setTimeout(() => setSyncStatus("IDLE"), 5000);
  };

  // Helper: build payload — keys match EXACTLY what Google Apps Script reads
  // "Loại công văn" cho phép Apps Script ghi đúng sheet tab
  const buildSheetsPayload = (data: CongVanData) => ({
    "Loại công văn": data["Loại công văn"] || "N/A",
    "Ngày/Tháng": data["Ngày/Tháng"] || "N/A",
    "Số văn bản": data["Số văn bản"] || "N/A",
    "Ngày văn bản": data["Ngày văn bản"] || "N/A",
    "Tóm nội dung chính": data["Tóm nội dung chính"] || "N/A",
    "Đơn vị gửi đến": data["Đơn vị gửi đến"] || "N/A",
    "Người nhận": data["Người nhận"] || "N/A",
    "Tên File CV": data["Tên File CV"] || "N/A",
  });

  const handleDataUpdate = (index: number, updatedItem: CongVanData) => {
    const updated = [...extractedData];
    updated[index] = updatedItem;
    setExtractedData(updated);
  };

  const handleSync = async () => {
    if (extractedData.length === 0) return;
    const savedSettings = localStorage.getItem("contract_ai_settings");
    const settings = savedSettings ? JSON.parse(savedSettings) : null;

    const scriptUrl = (settings && settings.scriptUrl) ? settings.scriptUrl : "";
    if (!scriptUrl) { alert("Chưa cấu hình Google Apps Script URL trong Settings."); setSyncStatus("IDLE"); return; }

    setSyncStatus("SYNCING");
    try {
      for (const data of extractedData) {
        const payload = buildSheetsPayload(data);
        console.log(`📤 Manual sync "${payload["Loại công văn"]}"`);
        const resp = await fetch("/api/sync-sheets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scriptUrl, payload }),
        });
        const result = await resp.json();
        console.log(`✅ Manual sync result:`, result);
        await new Promise(r => setTimeout(r, 500));
      }
      setSyncStatus("SUCCESS");
      setTimeout(() => setSyncStatus("IDLE"), 5000);
    } catch (error) {
      console.error("Sync error:", error);
      alert("Failed to sync to Google Sheets.");
      setSyncStatus("IDLE");
    }
  };

  return (
    <main className="relative flex h-screen w-full overflow-hidden" style={{ background: '#050505', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      {/* Subtle radial glow background */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 50% at 20% 50%, rgba(0,242,255,0.03) 0%, transparent 70%), radial-gradient(ellipse 40% 60% at 80% 30%, rgba(155,93,229,0.03) 0%, transparent 70%)'
      }} />

      {/* Settings Button */}
      <button
        onClick={() => setIsSettingsOpen(true)}
        className="absolute top-5 left-5 z-20 w-10 h-10 flex items-center justify-center rounded-xl border border-white/10 text-white/40 hover:text-white hover:border-[rgba(0,242,255,0.3)] hover:shadow-[0_0_15px_rgba(0,242,255,0.2)] transition-all group"
        style={{ background: 'rgba(18,18,18,0.8)', backdropFilter: 'blur(20px)' }}
      >
        <Settings className="w-4 h-4 group-hover:rotate-90 transition-transform duration-500" />
      </button>

      {/* Left Panel: Upload OR PDF Viewer */}
      <div className="w-[40%] h-full shrink-0 p-4">
        {status === "SUCCESS" && fileUrls.length > 0 ? (
          <div className="h-full w-full flex flex-col rounded-2xl overflow-hidden border border-white/[0.08] shadow-[0_0_0_1px_rgba(0,242,255,0.06),0_0_40px_rgba(0,242,255,0.04),0_20px_60px_rgba(0,0,0,0.8)]" style={{ background: 'rgba(12,12,12,0.95)' }}>
            {/* PDF Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]" style={{ background: 'rgba(18,18,18,0.8)' }}>
              <div>
                <h3 className="text-xs font-bold text-white/90 tracking-wide">📄 File Công Văn Gốc</h3>
                <p className="text-[10px] text-white/30 mt-0.5">Đối chiếu thông tin trực tiếp</p>
              </div>
              <div className="flex items-center gap-2">
                {fileUrls.length > 1 && fileUrls.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedPdfIndex(i)}
                    className={`w-7 h-7 rounded-lg text-[11px] font-bold transition-all border ${i === selectedPdfIndex
                      ? 'text-[#00f2ff] border-[rgba(0,242,255,0.3)] shadow-[0_0_10px_rgba(0,242,255,0.2)]'
                      : 'text-white/30 border-white/10 hover:text-white'}`}
                    style={{ background: i === selectedPdfIndex ? 'rgba(0,242,255,0.1)' : 'rgba(255,255,255,0.03)' }}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  onClick={() => { setStatus("IDLE"); setPreviews([]); setFileUrls([]); setExtractedData([]); setValidationScores([]); }}
                  className="px-3 py-1.5 text-[10px] font-bold text-white/30 hover:text-[#00f2ff] border border-white/10 hover:border-[rgba(0,242,255,0.25)] rounded-lg transition-all"
                  style={{ background: 'rgba(255,255,255,0.03)' }}
                >
                  Upload mới
                </button>
              </div>
            </div>
            {/* PDF Iframe */}
            <iframe
              src={fileUrls[selectedPdfIndex]}
              className="flex-1 w-full border-0"
              title="PDF Viewer"
            />
          </div>
        ) : (
          <UploadPanel
            onUpload={handleUpload}
            status={status}
            processingText={processingText}
          />
        )}
      </div>

      <div className="w-[60%] h-full shrink-0">
        <ResultsPanel
          dataList={extractedData}
          validationScoresList={validationScores}
          previews={previews}
          fileUrls={fileUrls}
          selectedPdfIndex={selectedPdfIndex}
          onSelectPdf={setSelectedPdfIndex}
          onUpdate={handleDataUpdate}
          onSync={handleSync}
          syncStatus={syncStatus}
        />
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={(settings) => console.log("Saved config:", settings)}
      />
    </main>
  );
}
