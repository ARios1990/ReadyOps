import "jsr:@supabase/functions-js/edge-runtime.d.ts";
Deno.serve(() => Response.json({ error: "Not found" }, { status: 404 }));
