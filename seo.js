const supabase = require('./supabaseClient');

// SINGLE-SALON PRODUCT.
//
// This resolves the ONE salon row, ONCE, at server boot (see server.js's
// startServer()). It is deliberately never called per-request: `salonId` is a
// module-level constant for the process lifetime. Requests cannot select a
// salon, and no client-supplied header or query param influences it.
async function getSalonBySlug(slug) {
  if (!slug) return null;
  if (!supabase) return null; // local JSON-file mode: no Supabase configured
  const { data, error } = await supabase
    .from('salons')
    .select('*')
    .eq('slug', slug)
    .eq('active', true)
    .maybeSingle();
  if (error) throw new Error(`Error resolving salon "${slug}": ${error.message}`);
  return data || null;
}

module.exports = { getSalonBySlug };
