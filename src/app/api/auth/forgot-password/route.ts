import { NextResponse } from "next/server";
import { mapAuthErrorToHttp, requestPasswordReset } from "../../../../server/services/authService";
export async function POST(request: Request) {
    try {
        const payload = await request.json();
        const origin = new URL(request.url).origin;
        const result = await requestPasswordReset(origin, payload);
        return NextResponse.json(result, { status: 202 });
    }
    catch (error) {
        const mapped = mapAuthErrorToHttp(error);
        return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
}
