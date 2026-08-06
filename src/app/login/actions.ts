"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string } | undefined;

export async function signIn(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your username or email and password." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { error: "Incorrect username or password. Please use the provided demo credentials." };
  }

  const { data: employee } = await supabase
    .from("employees")
    .select("id, status")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();

  if (employee?.status === "disabled") {
    await supabase.auth.signOut();
    return { error: "This account has been disabled. Contact your administrator." };
  }

  if (employee) {
    await Promise.all([
      supabase.from("login_history").insert({
        employee_id: employee.id,
        device: "Web browser",
        status: "active",
      }),
      supabase
        .from("employees")
        .update({ last_login_at: new Date().toISOString() })
        .eq("id", employee.id),
    ]);
  }

  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
