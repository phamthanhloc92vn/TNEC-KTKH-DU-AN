"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback } from "react";
import { Settings } from "lucide-react";
import UploadPanel from "./components/UploadPanel";
import ResultsPanel from "./components/ResultsPanel";
import SettingsModal from "./components/SettingsModal";

const DEFAULT_PROJECTS = [
  "Rạch xuyên tâm",
  "Hương lộ 11",
  "Xử lý nước thải tây ninh",
  "Thường Phước",
  "Cầu Mã Đà",
  "Tổng Hợp",
];

interface HopDongData {
  stt: string;
  tenDuAn: string;
  soHopDong: string;
  donViKy: string;
  giaTri: string;
  tiLeHopDong: string;
  daTamUng: string;
  thuHoiTamUng: string;
  conLaiChuaThuHoi: string;
  loaiHopDong: string;
  tenFileHD: string;
}

export default function Home() {
  const [status, setStatus] = useState<"IDLE" | "PROCESSING" | "SUCCESS">("IDLE");
  const [processingText, setProcessingText] = useState("");
  const [extractedData, setExtractedData] = useState<HopDongData[]>([]);
  const [validationScores, setValidationScores] = useState<Record<string, number>[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [fileUrls, setFileUrls] = useState<string[]>([]);
  const [selectedPdfIndex, setSelectedPdfIndex] = useState(0);
  const [syncStatus, setSyncStatus] = useState<"IDLE" | "SYNCING" | "SUCCESS">("IDLE");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [projectOptions, setProjectOptions] = useState<string[]>(DEFAULT_PROJECTS);
  const [selectedProject, setSelectedProject] = useState("Tổng Hợp");

  const loadProjects = useCallback(() => {
    const saved = localStorage.getItem("tnec_hd_projects");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setProjectOptions(parsed);
          if (!parsed.includes(selectedProject)) setSelectedProject(parsed[0]);
        }
      } catch (e) { /* ignore */ }
    }
  }, [selectedProject]);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const handleSettingsClose = () => {
    setIsSettingsOpen(false);
    loadProjects();
  };

  const handleUpload = async (files: File[]) => {
    const savedSettings = localStorage.getItem("contract_ai_settings");
    if (!savedSettings) {
      alert("Vui lòng cấu hình API Key trong Settings trước.");
      setIsSettingsOpen(true);
      return;
    }
    const settings = JSON.parse(savedSettings);
    if (!settings.apiKey) {
      alert("Vui lòng nhập OpenAI API Key trong Settings.");
      setIsSettingsOpen(true);
      return;
    }

    setStatus("PROCESSING");
    const newData: HopDongData[] = [...extractedData];
    const newScores: Record<string, number>[] = [...validationScores];
    const newPreviews: string[] = [...previews];
    const newFileUrls: string[] = [...fileUrls];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProcessingText(`Đang xử lý file ${i + 1}/${files.length} (${file.name})...`);

      try {
        const fileUrl = URL.createObjectURL(file);
        newFileUrls.push(fileUrl);
        setFileUrls([...newFileUrls]);

        // 1. Convert PDF to images via CDN pdf.js
        setProcessingText(`Đang xử lý hình ảnh PDF...`);
        const pageImages: string[] = [];
        let previewBase64 = "";

        try {
          const pdfjsLib = (window as any).pdfjsLib;
          if (!pdfjsLib) throw new Error("pdf.js not loaded from CDN");

          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({
            data: arrayBuffer,
            disableFontFace: true,
            useSystemFonts: true,
          }).promise;

          // Vercel giới hạn request body 4.5MB → chỉ gửi 20 trang đầu
          // Đủ bao gồm các điều khoản tiền bạc thường nằm ở nửa đầu HĐ
          const totalPages = pdf.numPages;
          const MAX_READ = 20;
          const pagesToRender: number[] = [];
          
          for (let p = 1; p <= Math.min(totalPages, MAX_READ); p++) {
            pagesToRender.push(p);
          }
          
          // Nếu HĐ dài, thêm trang cuối để bắt chữ ký
          if (totalPages > MAX_READ) {
            const lastPage = totalPages;
            if (!pagesToRender.includes(lastPage)) pagesToRender.push(lastPage);
          }
          
          console.log(`📄 PDF: ${totalPages} trang, gửi ${pagesToRender.length} trang (Vercel 4.5MB limit).`);

          for (const p of pagesToRender) {
            setProcessingText(`Đang render trang ${p}/${totalPages}...`);
            const page = await pdf.getPage(p);
            const viewport = page.getViewport({ scale: 1.0 }); // Scale 1.0 → ảnh nhỏ hơn, vẫn đọc được với detail:high
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            if (ctx) {
              await page.render({ canvasContext: ctx, viewport: viewport }).promise;
              const dataUrl = canvas.toDataURL("image/jpeg", 0.5); // Quality 0.5 → payload nhỏ, dưới giới hạn Vercel 4.5MB
              pageImages.push(dataUrl);
              if (p === 1) previewBase64 = dataUrl;
            }
          }
        } catch (pdfErr) {
          console.error("❌ Lỗi render PDF sang ảnh:", pdfErr);
        }

        newPreviews.push(previewBase64);
        setPreviews([...newPreviews]);

        // 2. Send to AI
        const selectedModel = settings.model || "gpt-4o";
        console.log(`🤖 Model đang dùng: ${selectedModel}`);
        setProcessingText(`Đang gửi lên AI (${selectedModel}) để phân tích hợp đồng...`);
        const formData = new FormData();
        formData.append("file", file);
        formData.append("model", selectedModel);
        if (pageImages.length > 0) {
          pageImages.forEach((img, idx) => {
            formData.append(`image_page_${idx + 1}`, img);
          });
          formData.append("total_pages_sent", String(pageImages.length));
          console.log(`📤 Gửi ${pageImages.length} ảnh lên AI (model: ${selectedModel})`);
        } else {
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
          throw new Error(`API Error (HTTP ${response.status}): Server did not return valid JSON.`);
        }

        if (!response.ok) {
          throw new Error(result.error || `Server error ${response.status}`);
        }

        // Inject STT (auto-increment) and filename
        result.data.stt = String(newData.length + 1);
        result.data.tenFileHD = file.name;

        newData.push(result.data);
        newScores.push(result.validationScores || {});

        setExtractedData([...newData]);
        setValidationScores([...newScores]);

        // 3. Auto-Sync to Google Sheets
        const scriptUrl = settings.scriptUrl || "";
        if (scriptUrl) {
          setProcessingText(`Đang đồng bộ "${result.data?.soHopDong || "N/A"}" lên Google Sheets (${selectedProject})...`);
          try {
            // Sync 1: Gửi đến sheet dự án riêng
            const payload = buildSheetsPayload(result.data);
            console.log(`📤 Sync [${i + 1}/${files.length}] → sheet "${selectedProject}"`);
            const syncResp = await fetch("/api/sync-sheets", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ scriptUrl, payload }),
            });
            const syncResult = await syncResp.json();
            console.log(`✅ Sync [${i + 1}] project sheet:`, syncResult);

            // Sync 2: Gửi đến sheet "Tổng Hợp"
            setProcessingText(`Đang đồng bộ về Tổng Hợp...`);
            const tongHopPayload = buildSheetsPayload(result.data, "Tổng Hợp");
            console.log(`📤 Sync [${i + 1}] → sheet "Tổng Hợp" (loại: ${result.data.loaiHopDong || "CHU_DAU_TU"})`);
            const tongHopResp = await fetch("/api/sync-sheets", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ scriptUrl, payload: tongHopPayload }),
            });
            const tongHopResult = await tongHopResp.json();
            console.log(`✅ Sync [${i + 1}] Tổng Hợp:`, tongHopResult);

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

  const buildSheetsPayload = (data: HopDongData, targetSheet?: string) => ({
    sheetName: targetSheet || selectedProject,
    stt: data.stt || "N/A",
    tenDuAn: data.tenDuAn || "N/A",
    soHopDong: data.soHopDong || "N/A",
    donViKy: data.donViKy || "N/A",
    giaTri: data.giaTri || "N/A",
    tiLeHopDong: data.tiLeHopDong || "N/A",
    daTamUng: data.daTamUng || "N/A",
    thuHoiTamUng: data.thuHoiTamUng || "N/A",
    conLaiChuaThuHoi: data.conLaiChuaThuHoi || "N/A",
    loaiHopDong: data.loaiHopDong || "CHU_DAU_TU",
    tenFileHD: data.tenFileHD || "N/A",
  });

  const handleDataUpdate = (index: number, updatedItem: HopDongData) => {
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
        // Sync 1: Sheet dự án
        const payload = buildSheetsPayload(data);
        console.log(`📤 Manual sync → sheet "${selectedProject}"`);
        const resp = await fetch("/api/sync-sheets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scriptUrl, payload }),
        });
        const result = await resp.json();
        console.log(`✅ Manual sync project:`, result);

        // Sync 2: Sheet Tổng Hợp
        const tongHopPayload = buildSheetsPayload(data, "Tổng Hợp");
        console.log(`📤 Manual sync → sheet "Tổng Hợp"`);
        const tongHopResp = await fetch("/api/sync-sheets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scriptUrl, payload: tongHopPayload }),
        });
        const tongHopResult = await tongHopResp.json();
        console.log(`✅ Manual sync Tổng Hợp:`, tongHopResult);

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
                <h3 className="text-xs font-bold text-white/90 tracking-wide">📄 File Hợp Đồng Gốc</h3>
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
            selectedProject={selectedProject}
            onProjectChange={setSelectedProject}
            projectOptions={projectOptions}
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
        onClose={handleSettingsClose}
        onSave={(settings) => console.log("Saved config:", settings)}
      />
    </main>
  );
}
