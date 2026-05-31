declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    log: import("@/lib/log").Logger;
    requestId: string;
  }
}
