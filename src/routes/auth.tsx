import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { signUpWithInvitation } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in · Northwind Ops" },
      {
        name: "description",
        content: "Log in to Northwind Ops, or create your account from a company invitation.",
      },
      { property: "og:title", content: "Sign in · Northwind Ops" },
      { property: "og:description", content: "Invite-only access to the Northwind workspace." },
    ],
  }),
  component: AuthPage,
});

const credentials = z.object({
  email: z.string().trim().email("Enter a valid email address").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = credentials.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]!.message);
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const result = await signUpWithInvitation({ data: parsed.data });
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        const { error } = await supabase.auth.signInWithPassword(parsed.data);
        if (error) {
          toast.success("Account created. Please log in.");
          setMode("login");
          return;
        }
        toast.success("Welcome aboard!");
        navigate({ to: "/dashboard", replace: true });
      } else {
        const { error } = await supabase.auth.signInWithPassword(parsed.data);
        if (error) {
          toast.error("Those credentials didn't work. Check your email and password.");
          return;
        }
        navigate({ to: "/dashboard", replace: true });
      }
    } catch (error) {
      console.error(error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
            N
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">Northwind Ops</span>
        </div>
        <h1 className="text-2xl font-semibold">Internal workspace</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Access is invite-only. If you haven't been invited yet, ask a company admin.
        </p>

        <Tabs value={mode} onValueChange={setMode} className="mt-8">
          <TabsList className="w-full">
            <TabsTrigger value="login" className="flex-1">
              Log in
            </TabsTrigger>
            <TabsTrigger value="signup" className="flex-1">
              Create account
            </TabsTrigger>
          </TabsList>

          {["login", "signup"].map((tab) => (
            <TabsContent key={tab} value={tab}>
              <form onSubmit={handleSubmit} className="panel mt-4 space-y-4 p-6">
                <div className="space-y-2">
                  <Label htmlFor={`${tab}-email`}>Work email</Label>
                  <Input
                    id={`${tab}-email`}
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${tab}-password`}>Password</Label>
                  <Input
                    id={`${tab}-password`}
                    type="password"
                    autoComplete={tab === "signup" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Working…" : tab === "signup" ? "Create account" : "Log in"}
                </Button>
              </form>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
