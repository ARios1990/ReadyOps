import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

/** Field a duplicate was matched on. */
export type DuplicateField = "phone" | "name" | "address" | "agent";

/** An earlier or later lead that looks like the same customer. */
export interface LeadDuplicateMatch {
  id: string;
  lead_code: string | null;
  full_name: string | null;
  phone_number: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  agent_name: string | null;
  company_name: string | null;
  submitted_at: string;
  qc_status: string | null;
  matched_on: DuplicateField[];
}

/** Duplicate matches keyed by the lead id they were found for. */
export type LeadDuplicateMap = Record<string, LeadDuplicateMatch[]>;

function isMatch(value: unknown): value is LeadDuplicateMatch {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LeadDuplicateMatch>;
  return typeof item.id === "string" && typeof item.submitted_at === "string" && Array.isArray(item.matched_on);
}

function parseDuplicateMap(value: unknown): LeadDuplicateMap {
  const result: LeadDuplicateMap = {};
  if (!Array.isArray(value)) return result;
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const { lead_id, matches } = entry as { lead_id?: unknown; matches?: unknown };
    if (typeof lead_id !== "string" || !Array.isArray(matches)) continue;
    const valid = matches.filter(isMatch);
    if (valid.length) result[lead_id] = valid;
  }
  return result;
}

/**
 * Loads possible duplicates for the given leads. Only QC and Admin users may call this;
 * pass `enabled: false` for anyone else.
 */
export function useLeadDuplicates(leadIds: string[], enabled: boolean) {
  const [duplicates, setDuplicates] = useState<LeadDuplicateMap>({});
  const [error, setError] = useState("");
  const key = useMemo(() => [...new Set(leadIds)].sort().join(","), [leadIds]);

  useEffect(() => {
    if (!enabled || !key) {
      setDuplicates({});
      setError("");
      return;
    }
    let cancelled = false;
    void supabase
      .rpc("qc_find_lead_duplicates", { p_lead_ids: key.split(",").slice(0, 500) })
      .then(({ data, error: rpcErr }) => {
        if (cancelled) return;
        if (rpcErr) {
          setError(rpcErr.message || "Duplicate check failed.");
          setDuplicates({});
          return;
        }
        setError("");
        setDuplicates(parseDuplicateMap(data));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, key]);

  return { duplicates, error };
}
