import { db } from "@/lib/db";
import { users } from "@/db/schema";

export async function GET() {
  const rows = await db.select().from(users);
  return Response.json(rows);
}
