import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { createLogger, resolveRequestId } from "@/lib/log";
import { safeRedirectPath } from "@/lib/redirect";

// Routes that require a Supabase session (S-01). `/` is matched exactly so the
// gate never catches `/auth/*` or static assets; the rest match the path or a
// `/`-bounded sub-path. Pages redirect to sign-in; `/api/*` returns 401 JSON.
function isGated(pathname: string): boolean {
  if (pathname === "/") return true;
  return ["/dashboard", "/history", "/api/evaluate"].some(
    (route) => pathname === route || pathname.startsWith(route + "/"),
  );
}

export const onRequest = defineMiddleware(async (context, next) => {
  const requestId = resolveRequestId(context.request.headers);
  context.locals.requestId = requestId;

  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  // Build the request-bound logger after the user is resolved so user_id is
  // populated. Every route reads this via locals.log.
  context.locals.log = createLogger({
    request_id: requestId,
    route: context.url.pathname,
    method: context.request.method,
    user_id: context.locals.user?.id ?? null,
  });

  if (!context.locals.user && isGated(context.url.pathname)) {
    context.locals.log.warn("auth_required", { outcome: "failure" });

    // API requests get JSON 401 — an HTML 302 to a JSON fetch is a silent
    // client failure. Page requests get a redirect to sign-in carrying the
    // original (sanitized) target so the user lands back where they headed.
    if (context.url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json", "x-request-id": requestId },
      });
    }

    const target = safeRedirectPath(context.url.pathname + context.url.search);
    const redirect = context.redirect(`/auth/signin?redirect=${encodeURIComponent(target)}`);
    redirect.headers.set("x-request-id", requestId);
    return redirect;
  }

  const response = await next();
  try {
    response.headers.set("x-request-id", requestId);
  } catch {
    // Some adapter responses (e.g. certain static/HEAD/304 cases) expose
    // immutable headers; the correlation id is best-effort, never fatal.
  }
  return response;
});
