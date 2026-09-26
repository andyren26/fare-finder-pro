import { redirect } from "react-router";

import { supabase } from "@/integrations/supabase/client";

// Route loader: runs before a protected page renders and sends signed-out
// visitors to the sign-in page.
export async function requireSession() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    throw redirect("/sign-in");
  }
  return null;
}
