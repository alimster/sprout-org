import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const signUpSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(72),
});

export type SignUpResult = { ok: true } | { ok: false; message: string };

/**
 * Invite-only signup. The invitation lookup and the auth-user creation both
 * happen here on the server with the service role, so a browser cannot skip
 * the allowlist check. No auth user is created unless a pending invitation
 * exists for the email.
 */
export const signUpWithInvitation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => signUpSchema.parse(input))
  .handler(async ({ data }): Promise<SignUpResult> => {
    const email = data.email.toLowerCase();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: invites, error: inviteError } = await supabaseAdmin.rpc(
      "get_pending_invitation",
      { _email: email },
    );

    if (inviteError) {
      console.error("invitation lookup failed", inviteError);
      return { ok: false, message: "We couldn't verify your invitation. Please try again." };
    }

    const invitation = invites?.[0];
    if (!invitation) {
      return {
        ok: false,
        message:
          "This email isn't on the invite list. Ask a company admin to send you an invitation, then try again.",
      };
    }

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: invitation.full_name,
        title: invitation.title ?? "",
        department: invitation.department ?? "",
      },
    });

    if (createError || !created.user) {
      const message = createError?.message ?? "";
      if (/already/i.test(message)) {
        return { ok: false, message: "An account already exists for this email. Try logging in." };
      }
      console.error("createUser failed", createError);
      return { ok: false, message: "We couldn't create your account. Please try again." };
    }

    const userId = created.user.id;

    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: invitation.role });
    if (roleError) console.error("role assignment failed", roleError);

    const { error: acceptError } = await supabaseAdmin
      .from("invitations")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", invitation.id);
    if (acceptError) console.error("invitation accept failed", acceptError);

    const { error: resolveError } = await supabaseAdmin.rpc("resolve_managers", {
      _user_id: userId,
    });
    if (resolveError) console.error("manager resolution failed", resolveError);

    return { ok: true };
  });
