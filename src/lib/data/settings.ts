import "server-only";
import { createClient } from "@/lib/supabase/server";

export type PharmacyProfile = {
  name: string;
  email: string;
  phone: string;
  address: string;
  currency: string;
  tax_mode: string;
};

export type SettingsToggles = {
  prevent_expired_sales: boolean;
  use_fefo: boolean;
  require_reversal_approval: boolean;
  send_low_stock_alerts: boolean;
  detailed_audit_history: boolean;
  auto_backup_schedule: boolean;
};

export type SettingsData = {
  pharmacyProfile: PharmacyProfile;
  toggles: SettingsToggles;
};

const DEFAULT_PROFILE: PharmacyProfile = {
  name: "Mars Pharmacy",
  email: "",
  phone: "",
  address: "",
  currency: "TZS",
  tax_mode: "Inclusive",
};

const DEFAULT_TOGGLES: SettingsToggles = {
  prevent_expired_sales: false,
  use_fefo: false,
  require_reversal_approval: false,
  send_low_stock_alerts: false,
  detailed_audit_history: false,
  auto_backup_schedule: false,
};

export async function getSettingsData(): Promise<SettingsData> {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("settings")
    .select("key, value")
    .is("branch_id", null)
    .in("key", ["pharmacy_profile", "toggles"]);

  const profileRow = (rows ?? []).find((r) => r.key === "pharmacy_profile");
  const togglesRow = (rows ?? []).find((r) => r.key === "toggles");

  const pharmacyProfile: PharmacyProfile = {
    ...DEFAULT_PROFILE,
    ...((profileRow?.value as Partial<PharmacyProfile>) ?? {}),
  };

  const toggles: SettingsToggles = {
    ...DEFAULT_TOGGLES,
    ...((togglesRow?.value as Partial<SettingsToggles>) ?? {}),
  };

  return { pharmacyProfile, toggles };
}
