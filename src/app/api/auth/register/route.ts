import { NextResponse } from "next/server";
import { mapAuthErrorToHttp, registerAccount } from "../../../../server/services/authService";
export async function POST(request: Request) {
    try {
        const payload = await request.json();
        const result = await registerAccount(payload);
        return NextResponse.json(result, { status: 201 });
    }
    catch (error) {
        const mapped = mapAuthErrorToHttp(error);
        return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
}
