import "server-only";
import { createClient } from "@/lib/supabase/server";

export type PickerOption = { id: string; name: string };

export type AiAssistantData = {
  products: PickerOption[];
  customers: PickerOption[];
  suppliers: PickerOption[];
};

export async function getAiAssistantData(): Promise<AiAssistantData> {
  const supabase = await createClient();
  const [{ data: products }, { data: customers }, { data: suppliers }] = await Promise.all([
    supabase.from("products").select("id, name").order("name"),
    supabase.from("customers").select("id, name").order("name"),
    supabase.from("suppliers").select("id, name").order("name"),
  ]);

  return {
    products: products ?? [],
    customers: customers ?? [],
    suppliers: suppliers ?? [],
  };
}
