/**
 * Map a Supabase auth error message to a coarse, PII-free reason category for
 * structured logging. The raw message (which can echo user input) is never
 * logged — only the category returned here.
 */
export function categorizeAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "invalid_credentials";
  if (m.includes("email not confirmed")) return "email_not_confirmed";
  if (m.includes("already registered") || m.includes("already exists")) return "user_exists";
  if (m.includes("password")) return "weak_password";
  if (m.includes("rate limit")) return "rate_limited";
  return "unknown";
}
