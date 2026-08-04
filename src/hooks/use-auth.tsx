import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "member";

export type Profile = {
  id: string;
  full_name: string;
  title: string | null;
  department: string | null;
  email: string;
  manager_id: string | null;
  is_active: boolean;
};

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load(next: Session | null) {
      if (!active) return;
      setSession(next);
      if (!next) {
        setProfile(null);
        setRole(null);
        setLoading(false);
        return;
      }
      const [{ data: p }, { data: r }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, title, department, email, manager_id, is_active")
          .eq("id", next.user.id)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", next.user.id).maybeSingle(),
      ]);
      if (!active) return;
      setProfile((p as Profile) ?? null);
      setRole((r?.role as AppRole) ?? null);
      setLoading(false);
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      void load(next);
    });
    void supabase.auth.getSession().then(({ data }) => load(data.session));

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, profile, role, loading, isAdmin: role === "admin" };
}
