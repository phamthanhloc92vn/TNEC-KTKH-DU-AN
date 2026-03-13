import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { scriptUrl, payload } = body;

        if (!scriptUrl) {
            return NextResponse.json({ error: 'Missing scriptUrl' }, { status: 400 });
        }
        if (!payload) {
            return NextResponse.json({ error: 'Missing payload' }, { status: 400 });
        }

        const sheetName = payload.sheetName || "Tổng Hợp";
        console.log(`📤 Server sync → sheet "${sheetName}" (HĐ: ${payload.soHopDong || "N/A"}) → ${scriptUrl.substring(0, 60)}...`);

        // Forward payload to Google Apps Script — no CORS issues from server
        const response = await fetch(scriptUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            redirect: "follow",
        });

        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch {
            result = { status: "unknown", raw: text.substring(0, 200) };
        }

        console.log(`✅ Apps Script response:`, JSON.stringify(result));
        return NextResponse.json(result);

    } catch (error: unknown) {
        console.error('❌ Sync proxy error:', error);
        const msg = error instanceof Error ? error.message : 'Sync failed';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
