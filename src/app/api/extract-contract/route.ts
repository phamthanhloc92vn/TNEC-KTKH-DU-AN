import { NextResponse } from 'next/server';
import OpenAI from 'openai';

// Tăng body size limit cho Next.js API route
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '10mb',
        },
    },
};

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const pdfBase64Raw = formData.get('pdf_base64') as string;
        const apiKey = request.headers.get('x-api-key');
        // ÉP BUỘC dùng gpt-4o để đọc PDF scan tốt nhất (bỏ qua request từ client)
        const overrideModel = 'gpt-4o';

        if (!apiKey) {
            return NextResponse.json({ error: 'Thiếu API key. Vào Settings để cấu hình.' }, { status: 400 });
        }
        if (!file && !pdfBase64Raw) {
            return NextResponse.json({ error: 'Không có file PDF nào được gửi lên.' }, { status: 400 });
        }

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

        // ── 3. Xây dựng prompt ────────────────────────────────────────────────
        const systemPrompt = `Bạn là chuyên gia OCR và trích xuất dữ liệu công văn hành chính tại Việt Nam (thuộc Công ty CP Xây dựng và Lắp Máy Trung Nam - TNEC).
Nhiệm vụ: phân tích TOÀN BỘ nội dung công văn, xác định LOẠI CÔNG VĂN, và trả về JSON chính xác.

## XÁC ĐỊNH LOẠI CÔNG VĂN

### "Công văn đến"
- Góc trên TRÁI có tên đơn vị KHÁC (không phải Trung Nam/TNE&C/TNEC)
- VD: "BỘ XÂY DỰNG", "BAN QLDA MỸ THUẬN", "UBND TỈNH...", "BAN PMUMT"
- Văn bản do đơn vị bên ngoài GỬI ĐẾN

### "Công văn đi 1"
- Góc trên trái: "TRUNG NAM"/"TNE&C"/"TNEC"
- Ký hiệu: BBH hoặc QĐ (KHÔNG có HĐQT)
- VD: "49/QĐ/TNE&C", "12/BBH/TNE&C"

### "Công văn đi 1 - HĐQT"
- Góc trên trái: "TRUNG NAM"/"TNE&C"/"TNEC"
- Ký hiệu: BBH-HĐQT hoặc QĐ-HĐQT
- VD: "49/025/QĐ-HĐQT/TNE&C", "12/BBH-HĐQT/TNE&C"

### "Công văn đi 2"
- Góc trên trái: "TRUNG NAM"/"TNE&C"/"TNEC"
- Ký hiệu: CV, BC, TB, TT hoặc khác (KHÔNG phải BBH/QĐ)
- VD: "238/026/CV/TNE&C", "15/BC-TNE&C", "07/TB/TNEC"

## TRÍCH XUẤT 5 TRƯỜNG:
1. "Số văn bản": Chỉ lấy phần số+ký hiệu (KHÔNG lấy chữ "Số:"). 
   - ⚠️ LƯU Ý FILE SCAN: Chữ "Số:" và ký hiệu thường bị cách rất xa nhau (VD: "Số: 71      /PMUMT-ĐHDA1"). Hãy ghép chúng lại thành "71/PMUMT-ĐHDA1".
   - Nếu là văn bản không có số mà chỉ có ký hiệu, lấy đúng ký hiệu đó.
2. "Ngày văn bản": Tìm ngày ban hành ở góc trên (thường nằm cạnh Quốc hiệu "Độc lập - Tự do - Hạnh phúc"). 
   - Nó thường được in nghiêng dạng: "Thành phố Hồ Chí Minh, ngày 04 tháng 3 năm 2026" hoặc "TP.HCM, ngày 06 tháng 03 năm 2026".
   - BẮT BUỘC đổi sang định dạng DD/MM/YYYY (VD: "04/03/2026").
   - Nếu bị mờ không đọc được ngày cụ thể, hãy cố gắng suy luận từ tháng/năm. Nếu hoàn toàn không có, trả về "N/A" (TUYỆT ĐỐI không trả về chuỗi "DD/MM/YYYY").
3. "Tóm nội dung chính": Nội dung sau "V/v" hoặc "Về việc". Tóm lược ngắn gọn.
4. "Đơn vị gửi đến": Cơ quan ban hành (góc trái trên)
5. "Người nhận": Phần "Kính gửi"

## JSON BẮT BUỘC:
{
  "data": {
    "Loại công văn": "Công văn đến" | "Công văn đi 1" | "Công văn đi 1 - HĐQT" | "Công văn đi 2",
    "Số văn bản": "...",
    "Ngày văn bản": "04/03/2026",
    "Tóm nội dung chính": "...",
    "Đơn vị gửi đến": "...",
    "Người nhận": "..."
  },
  "validationScores": {
    "Loại công văn": 95,
    "Số văn bản": 90,
    "Ngày văn bản": 90,
    "Tóm nội dung chính": 88,
    "Đơn vị gửi đến": 85,
    "Người nhận": 85
  }
}`;

        // ── 4. Xây dựng user message ──────────────────────────────────────────
        const userContent: any[] = [];

        if (extractedText && extractedText.trim().length > 100) {
            userContent.push({
                type: "text",
                text: `VĂN BẢN TRÍCH XUẤT TỪ PDF (${extractedText.length} ký tự):\n\n${extractedText.substring(0, 50000)}`
            });
        }

        // ── 4b. Thêm ảnh vào user message nếu có ─────────────────────────────
        if (hasImages) {
            userContent.push({
                type: "text",
                text: "Dưới đây là hình ảnh các trang của văn bản được scan. Hãy ĐỌC KỸ TỪNG CHỮ trong ảnh, đặc biệt là phần Số văn bản và Ngày văn bản ở đầu trang:"
            });
            for (const img of pageImages) {
                // Đảm bảo định dạng chuẩn data URI cho hình ảnh
                const imageUrl = img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}`;
                userContent.push({
                    type: "image_url",
                    image_url: { url: imageUrl, detail: "high" } // Dùng detail high để soi rõ chữ Mờ/Nhỏ
                });
            }
        } else if (userContent.length === 0) {
            // Nếu không có text và không có ảnh → báo lỗi
            return NextResponse.json({
                error: 'Không nhận diện được nội dung công văn. File PDF có thể là ảnh scan không có text layer.'
            }, { status: 400 });
        }

        console.log(`🤖 Dùng Chat Completions (Vision: ${hasImages}, Text-parts: ${userContent.length})`);

        const completion = await openai.chat.completions.create({
            model: overrideModel,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent }
            ]
        });

        const resultText = completion.choices[0].message.content || "{}";
        const result = JSON.parse(resultText);
        console.log("✅ AI Response (Chat):", JSON.stringify(result, null, 2));
        return NextResponse.json(result);

    } catch (error: unknown) {
        console.error('❌ API error:', error);
        const msg = error instanceof Error ? error.message : 'Internal Server Error';
        // Trả message rõ ràng
        if (msg.includes('API key')) {
            return NextResponse.json({ error: 'API key không hợp lệ. Kiểm tra lại trong Settings.' }, { status: 400 });
        }
        if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
            return NextResponse.json({ error: 'AI xử lý quá lâu. Thử lại với file PDF nhỏ hơn.' }, { status: 408 });
        }
        return NextResponse.json({ error: `Lỗi server: ${msg}` }, { status: 500 });
    }
}
