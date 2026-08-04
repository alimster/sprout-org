import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getUser();
    throw redirect({ to: data.user ? "/dashboard" : "/auth" });
  },
  head: () => ({
    meta: [
      { title: "Northwind Ops — Internal Company Workspace" },
      {
        name: "description",
        content:
          "Invite-only internal workspace for Northwind staff: org chart, documents and tasks in one place.",
      },
      { property: "og:title", content: "Northwind Ops — Internal Company Workspace" },
      {
        property: "og:description",
        content: "Invite-only internal workspace for Northwind staff.",
      },
    ],
  }),
  component: () => null,
});
