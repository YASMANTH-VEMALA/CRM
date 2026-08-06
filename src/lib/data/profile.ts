import "server-only";
import { getScope } from "./scope";
import { ROLE_LABELS } from "@/lib/permissions";
import { formatDateTime } from "@/app/dashboard/views/shared";

export type ProfileData = {
  employee: {
    full_name: string;
    username: string | null;
    email: string | null;
    role: string;
    status: string;
    branchName: string;
  };
  loginHistory: string[][];
};

const EMPTY_PROFILE: ProfileData = {
  employee: {
    full_name: "Unknown user",
    username: null,
    email: null,
    role: "—",
    status: "disabled",
    branchName: "All branches",
  },
  loginHistory: [],
};

export async function getProfileData(): Promise<ProfileData> {
  const { supabase, employee } = await getScope();
  if (!employee) return EMPTY_PROFILE;

  let branchName = "All branches";
  if (employee.branch_id) {
    const { data: branch } = await supabase
      .from("branches")
      .select("name")
      .eq("id", employee.branch_id)
      .maybeSingle();
    branchName = branch?.name ?? "All branches";
  }

  const { data: history } = await supabase
    .from("login_history")
    .select("created_at, device, session_ref, status")
    .eq("employee_id", employee.id)
    .order("created_at", { ascending: false })
    .limit(10);

  const loginHistory = (history ?? []).map((entry) => [
    formatDateTime(entry.created_at),
    entry.device ?? "—",
    "—",
    entry.session_ref ?? "—",
    entry.status[0].toUpperCase() + entry.status.slice(1),
  ]);

  return {
    employee: {
      full_name: employee.full_name,
      username: employee.username,
      email: employee.email,
      role: ROLE_LABELS[employee.role] ?? employee.role,
      status: employee.status,
      branchName,
    },
    loginHistory,
  };
}
