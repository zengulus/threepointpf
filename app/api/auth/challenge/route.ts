import { json } from "../../../../lib/accounts";

export async function GET() {
  return json({ error: { code: "not-found", message: "Sign-in challenge is unavailable." } }, 404);
}
