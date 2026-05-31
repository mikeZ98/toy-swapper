import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { createLogger, resolveRequestId } from "@/lib/log";

const PROTECTED_ROUTES = ["/dashboard"];

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

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      context.locals.log.warn("auth_required", { outcome: "failure" });
      const redirect = context.redirect("/auth/signin");
      redirect.headers.set("x-request-id", requestId);
      return redirect;
    }
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
