import { NextResponse } from "next/server";
import { mapAuthErrorToHttp, resetPassword } from "../../../../server/services/authService";
export async function POST(request: Request) {
    try {
        const payload = await request.json();
        const result = await resetPassword(payload);
        return NextResponse.json(result, { status: 200 });
    }
    catch (error) {
        const mapped = mapAuthErrorToHttp(error);
        return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
}
