import { redirect } from "next/navigation";
import { serverSessionValid } from "@/lib/session";

/**
 * Auth gate for every dashboard surface (/, /setup). An invalid or missing
 * session cookie bounces to /login; the login page itself lives outside this
 * route group so the two can't recurse.
 */
export default async function DashLayout({ children }: { children: React.ReactNode }) {
  if (!(await serverSessionValid())) redirect("/login");
  return <>{children}</>;
}
