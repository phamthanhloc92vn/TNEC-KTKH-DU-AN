import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '15mb',
        },
    },
};

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const pdfBase64Raw = formData.get('pdf_base64') as string;
        const apiKey = request.headers.get('x-api-key');
        const modelFromHeader = request.headers.get('x-model');
        const modelFromForm = formData.get('model') as string;
        const overrideModel = modelFromHeader || modelFromForm || 'gpt-4o';
        console.log(`🔧 Model: header=${modelFromHeader}, form=${modelFromForm}, using=${overrideModel}`);

        if (!apiKey) {
            return NextResponse.json({ error: 'Thiếu API key. Vào Settings để cấu hình.' }, { status: 400 });
        }
        // Không check file/pdf_base64 ở đây vì có thể chỉ gửi ảnh (tránh 413 Vercel)

        const openai = new OpenAI({ apiKey });

        // ── 1. Trích xuất text bằng pdf2json ──────────────────────────────────
        let extractedText = "";
        if (file) {
            try {
                const PDFParser = (await import('pdf2json')).default;
                const arrayBuffer = await file.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                extractedText = await new Promise<string>((resolve, reject) => {
                    const pdfParser = new PDFParser(null, true);
                    pdfParser.on("pdfParser_dataError", (errData: any) =>
                        reject(new Error(errData.parserError?.message || "PDF parse failed"))
                    );
                    pdfParser.on("pdfParser_dataReady", () => {
                        resolve(pdfParser.getRawTextContent());
                    });
                    pdfParser.parseBuffer(buffer);
                });
                console.log(`📝 pdf2json trích được ${extractedText.length} ký tự`);
            } catch (parseErr) {
                console.warn("⚠️ pdf2json failed (có thể PDF scan):", parseErr);
            }
        }

        // ── 2. Nhận ảnh từ Client (nếu có) ────────────────────────────────
        let hasImages = false;
        const pageImages: string[] = [];
        const totalPages = parseInt((formData.get("total_pages_sent") as string) || "0");

        for (let i = 1; i <= totalPages; i++) {
            const imgBase64 = formData.get(`image_page_${i}`) as string;
            if (imgBase64) {
                pageImages.push(imgBase64);
                hasImages = true;
            }
        }

        if (hasImages) {
            console.log(`📸 Nhận được ${pageImages.length} ảnh quét từ client`);
        } else if (!pdfBase64Raw) {
            return NextResponse.json({ error: 'Không tìm thấy dữ liệu PDF hoặc Ảnh' }, { status: 400 });
        }

        // ── 3. Xây dựng prompt cho HỢP ĐỒNG ─────────────────────────────────
        const systemPrompt = `Bạn là chuyên gia trích xuất dữ liệu HỢP ĐỒNG xây dựng tại Việt Nam.
Công ty cần trích xuất thông tin là: **Công ty Cổ phần Xây dựng và Lắp máy Trung Nam** (viết tắt: TNEC, Trungnam E&C, TNE&C, "Trung Nam").

🔴🔴🔴 CẢNH BÁO CỰC KỲ QUAN TRỌNG:
Đây thường là HỢP ĐỒNG LIÊN DANH — có NHIỀU công ty. BẠN PHẢI lấy đúng dữ liệu của TRUNG NAM. TUYỆT ĐỐI KHÔNG lấy nhầm của công ty đối tác.
Tên Trung Nam: "Công ty Cổ phần Xây dựng và Lắp máy Trung Nam", "Công ty CP XD và LM Trung Nam", "TNEC", "Trungnam E&C", "thành viên đứng đầu liên danh".
## TRÍCH XUẤT CÁC TRƯỜNG (TẤT CẢ PHẢI LÀ CỦA TRUNG NAM):

1. "tenDuAn": Tên dự án / công trình / gói thầu.
   - Ở phần đầu: "Dự án:", "Công trình:", "Gói thầu:".

🧠 CHIẾN THUẬT ĐỌC THÔNG MINH — THỰC HIỆN THEO 3 BƯỚC:

⚠️ QUAN TRỌNG: Các ảnh được đánh số đúng theo trang PDF thực tế.
   Ảnh số 1 = Trang 1, Ảnh số 15 = Trang 15, v.v.

**BƯỚC 1 — QUÉT MỤC LỤC (ảnh 1-4 đầu tiên):**
  Tìm bảng "MỤC LỤC" / "DANH MỤC" trong những ảnh đầu tiên.
  Xác định số trang cụ thể của từng Điều/Khoản:
  - "Giá trị hợp đồng" → Điều mấy, TRANG MẤY? (VD: Điều 4 - trang 8)
  - "Tạm ứng", "Thanh toán" → TRANG MẤY? (VD: Điều 9.3 - trang 22)
  - "Thành phần liên danh", "Tỷ lệ" → TRANG MẤY?

**BƯỚC 2 — NHẢY ĐẾN ĐÚNG ẢNH:**
  Từ số trang xác định ở Bước 1, TẬP TRUNG ĐỌC KỸ đúng ảnh đó.
  VD: Nếu "Tạm ứng" ở trang 22 → Đọc kỹ Ảnh số 22.
  Đây là bước QUAN TRỌNG NHẤT để bóc tách số tiền chính xác.

**BƯỚC 3 — TRÍCH XUẤT CHÍNH XÁC:**
  Lấy số liệu từ ảnh đã định vị ở Bước 2.
  Nếu không có Mục lục → đọc tuần tự toàn bộ ảnh, tìm từ khóa trực tiếp.

2. "soHopDong": Số hợp đồng.
   - Tìm: "Số:", "Hợp đồng số:", "HĐ số:".

3. "donViKy": BÊN A / chủ đầu tư (KHÔNG phải Trung Nam).
   - VD: "Ban QLDA...", "Sở...", "UBND..."

92. 🔴 QUY TẮC TIỀN TỆ: Luôn định dạng số tiền kết thúc bằng chữ " đồng".
93:    - Thay thế "VND", "VNĐ", "V.N.Đ" bằng " đồng".
94:    - VD: "1.000.000 VND" → "1.000.000 đồng" ✅

4. "giaTri": 🔴 GIÁ TRỊ HỢP ĐỒNG CỦA TRUNG NAM (KHÔNG phải tổng, KHÔNG phải của đối tác).
   - Nếu HĐ liên danh: tìm giá trị RIÊNG của Trung Nam = tổng giá trị × tỉ lệ Trung Nam.
   - Thường ghi dạng: "Giá trị hợp đồng XX% là YYY VND" ở dòng gắn với Trung Nam.
   VD THỰC TẾ:
   "a). Thành viên đứng đầu liên danh: Công ty CP Xây dựng và Lắp máy Trung Nam
    + Giá trị hợp đồng 87% là 95.092.891.627 VND"
   → giaTri = "95.092.891.627 đồng" ✅
   "b). Thành viên còn lại: Công ty CP CE Việt Nam
    + Giá trị hợp đồng 13% là 14.213.297.744 VND"
   → ĐÂY LÀ CỦA CE VIỆT NAM → KHÔNG LẤY!
   - Nếu HĐ không liên danh (chỉ 1 bên): lấy tổng giá trị hợp đồng và đổi đuôi sang " đồng".

5. "tiLeHopDong": 🔴 TỶ LỆ CỦA TRUNG NAM (KHÔNG phải đối tác).
   - Nếu loaiHopDong là "NHA_THAU_PHU" → Luôn để là "100%" (vì TNEC thuê thầu phụ làm trọn gói phần việc đó).
   - Nếu loaiHopDong là "CHU_DAU_TU":
     - Tìm trong: bảng "phân công phạm vi", "tỉ lệ liên danh", "tỉ lệ đảm nhận".
     - HOẶC tìm câu dạng: "Giá trị hợp đồng XX%" ở dòng có TRUNG NAM.
     VD THỰC TẾ:
     "a). Trung Nam: + Giá trị hợp đồng 87% là..."  → tiLeHopDong = "87%"
     "b). CE Việt Nam: + Giá trị hợp đồng 13% là..." → KHÔNG LẤY 13%!
   - 🔴 PHẢI kiểm tra dòng phía trên có chứa "Trung Nam" không.

6. "daTamUng": 🔴 TẠM ỨNG CỦA TRUNG NAM (KHÔNG phải tổng, KHÔNG phải đối tác).
   - Tìm ở mục "Tạm ứng" (Điều 9, 10, 9.3, hoặc phần "Thanh toán").
   - 🔴 CẢNH BÁO: Trong bản quét, "9.3. Tạm ứng" có thể ghi số tiền cụ thể ngay trong câu. Hãy đọc kỹ từng con số.
   VD THỰC TẾ:
   "...tạm ứng cho Bên B 30% giá trị hợp đồng tương ứng với số tiền là 1.952.408.185 VND"
   → daTamUng = "1.952.408.185 đồng" ✅
   - Dạng khác: "- Trung Nam: 16.997.650.451 đồng" → lấy số này.
   - Dạng khác: "Bảo lãnh tạm ứng" + số tiền gắn Trung Nam.
   - Luôn dùng đuôi " đồng". Nếu là "N/A" thì giữ nguyên.

7. "thuHoiTamUng": Thu hồi tạm ứng (nếu có). Không thấy → "N/A".

8. "conLaiChuaThuHoi": Tạm ứng chưa thu hồi. Không thấy → "N/A".

1. "donViKy": 🔴 Tên đơn vị đối tác ký hợp đồng VỚI Trung Nam:
   - Nếu HĐ là "Chủ đầu tư" ký với "Trung Nam" → Lấy tên Chủ đầu tư.
   - Nếu HĐ là "Trung Nam" ký với "Nhà thầu phụ" (Bên B) → Lấy tên Nhà thầu phụ.
   - ⚠️ TUYỆT ĐỐI KHÔNG lấy tên Trung Nam (TNEC) vào ô này.

... (bỏ qua các mục 2-8)

9. "loaiHopDong": 🔴 PHÂN LOẠI HỢP ĐỒNG (CỰC KỲ QUAN TRỌNG):
   CÁCH XÁC ĐỊNH: Nhìn vào ĐỐI TÁC (donViKy) ký với Trung Nam:

   ✅ "CHU_DAU_TU" — Nếu ĐỐI TÁC là CƠ QUAN NHÀ NƯỚC:
      Từ khóa: "Ban Quản lý", "Ban QLDA", "Sở", "UBND", "Khu kinh tế", "tỉnh", "thành phố", "huyện", "Bộ".
      Ý nghĩa: Trung Nam đi làm thuê cho Nhà nước.

   ✅ "NHA_THAU_PHU" — Nếu ĐỐI TÁC là CÔNG TY TƯ NHÂN (HĐ B-B'):
      Từ khóa: "Công ty TNHH", "Công ty CP", "Công ty cổ phần", "Tập đoàn".
      Tiêu đề thường gặp: "Hợp đồng thi công", "Hợp đồng giao khoán", "Hợp đồng thầu phụ".
      Ý nghĩa: Trung Nam thuê công ty khác làm (hoặc ký ngang hàng giữa 2 công ty tư nhân).
      VD THỰC TẾ: "Công ty TNHH Giải pháp Môi trường Đại Nam" → NHA_THAU_PHU ✅

   🔴 NGUYÊN TẮC VÀNG: Nếu đối tác là DOANH NGHIỆP/CÔNG TY tư nhân → Luôn là "NHA_THAU_PHU".

## 🔴 CHECKLIST BẮT BUỘC TRƯỚC KHI TRẢ KẾT QUẢ:
□ giaTri → Đây có phải giá trị của TRUNG NAM không? (KHÔNG phải tổng, KHÔNG phải đối tác)
□ tiLeHopDong → % này gắn với dòng "Trung Nam" chưa? Hay nhầm sang công ty khác?
□ daTamUng → Số tiền này gắn với "Trung Nam" chưa? Hay nhầm sang đối tác/tổng?
□ loaiHopDong → donViKy là cơ quan nhà nước (CHU_DAU_TU) hay công ty tư nhân (NHA_THAU_PHU)?
→ Nếu sai → TÌM LẠI dòng Trung Nam.

## LƯU Ý:
- Đọc KỸ toàn bộ hợp đồng và phụ lục.
- Giữ nguyên format số (dấu chấm phân cách).

## JSON BẮT BUỘC:
{
  "data": {
    "tenDuAn": "...",
    "soHopDong": "...",
    "donViKy": "...",
    "giaTri": "...",
    "tiLeHopDong": "...",
    "daTamUng": "...",
    "thuHoiTamUng": "...",
    "conLaiChuaThuHoi": "...",
    "loaiHopDong": "CHU_DAU_TU" hoặc "NHA_THAU_PHU"
  },
  "validationScores": {
    "tenDuAn": 0-100,
    "soHopDong": 0-100,
    "donViKy": 0-100,
    "giaTri": 0-100,
    "tiLeHopDong": 0-100,
    "daTamUng": 0-100,
    "thuHoiTamUng": 0-100,
    "conLaiChuaThuHoi": 0-100
  }
}`;

        // ── 4. Xây dựng user message ──────────────────────────────────────────
        // Chiến lược: Nếu pdf2json trích được đủ text → CHỈ GỬI TEXT (tiết kiệm token)
        // Nếu PDF scan không có text → gửi ảnh
        const userContent: any[] = [];
        const hasEnoughText = extractedText && extractedText.trim().length > 5000;

        if (hasEnoughText) {
            // TEXT-ONLY MODE: Gửi PHẦN ĐẦU + PHẦN CUỐI để bao phủ cả thanh toán/tạm ứng
            const totalLen = extractedText.length;
            const headChars = 30000;
            const tailChars = 25000;

            let textToSend: string;
            if (totalLen <= headChars + tailChars) {
                // Hợp đồng ngắn: gửi toàn bộ
                textToSend = extractedText;
            } else {
                // Hợp đồng dài: đầu + cuối
                const head = extractedText.substring(0, headChars);
                const tail = extractedText.substring(totalLen - tailChars);
                textToSend = head + "\n\n[...PHẦN GIỮA ĐÃ BỎ QUA...]\n\n" + tail;
            }

            userContent.push({
                type: "text",
                text: `NỘI DUNG HỢP ĐỒNG (${totalLen} ký tự tổng, gửi ${textToSend.length} ký tự — phần đầu + phần cuối):\n\n${textToSend}`
            });
            console.log(`📝 TEXT-ONLY mode: gửi ${textToSend.length} ký tự (head ${headChars} + tail ${tailChars}) từ tổng ${totalLen}`);
        } else if (hasImages) {
            // IMAGE MODE: PDF scan — gửi TẤT CẢ ảnh (detail:low = ~85 tokens/ảnh)
            userContent.push({
                type: "text",
                text: `PDF scan (${pageImages.length} trang). ĐỌC KỸ TỪNG TRANG, đặc biệt phần Giá hợp đồng, Tỷ lệ liên danh, và Tạm ứng (thường ở Điều 9-10, giữa hợp đồng). Lấy đúng dữ liệu của TRUNG NAM:`
            });
            for (const img of pageImages) {
                const imageUrl = img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}`;
                userContent.push({
                    type: "image_url",
                    image_url: {
                        url: imageUrl,
                        detail: "high" // Sử dụng detail cao để AI đọc được số nhỏ trong bản quét
                    }
                });
            }
            console.log(`📸 IMAGE mode: gửi TẤT CẢ ${pageImages.length} ảnh (detail:high)`);
        } else {
            return NextResponse.json({
                error: 'Không nhận diện được nội dung hợp đồng. File PDF có thể bị lỗi.'
            }, { status: 400 });
        }

        console.log(`🤖 Model: ${overrideModel}, Mode: ${hasEnoughText ? 'TEXT' : 'IMAGE'}, Parts: ${userContent.length}`);

        // o4-mini là reasoning model, không hỗ trợ response_format hay system role
        const isReasoningModel = overrideModel.startsWith('o');
        
        const completion = await openai.chat.completions.create({
            model: overrideModel,
            ...(isReasoningModel ? {} : { response_format: { type: "json_object" } }),
            ...(isReasoningModel ? {} : { max_tokens: 2000 }),
            messages: [
                { role: isReasoningModel ? "developer" : "system", content: systemPrompt },
                { role: "user", content: userContent }
            ]
        });

        const resultText = completion.choices[0].message.content || "{}";
        const result = JSON.parse(resultText);
        console.log("✅ AI Response (Contract):", JSON.stringify(result, null, 2));
        return NextResponse.json(result);

    } catch (error: unknown) {
        console.error('❌ API error:', error);
        const msg = error instanceof Error ? error.message : 'Internal Server Error';
        if (msg.includes('API key')) {
            return NextResponse.json({ error: 'API key không hợp lệ. Kiểm tra lại trong Settings.' }, { status: 400 });
        }
        if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
            return NextResponse.json({ error: 'AI xử lý quá lâu. Thử lại với file PDF nhỏ hơn.' }, { status: 408 });
        }
        return NextResponse.json({ error: `Lỗi server: ${msg}` }, { status: 500 });
    }
}
