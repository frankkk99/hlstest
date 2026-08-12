import { type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, createAdminSessionToken } from "@/lib/admin-auth";

export async function isAdminRequest(request: NextRequest) {
  const expected = await createAdminSessionToken();
  const provided = request.cookies.get(ADMIN_SESSION_COOKIE)?.value || "";
  return Boolean(expected && provided && provided === expected);
}
