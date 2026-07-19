#!/usr/bin/env node
/*
  Seeds a starter service catalog into the real `services` table for an
  existing salon (the salon row itself is created by running sql/schema.sql,
  which already inserts 'nails' and 'makeup' starter salons — see that file).

  Usage:
    export SUPABASE_URL="https://xxxx.supabase.co"
    export SUPABASE_SERVICE_ROLE_KEY="eyJ...service-role-key..."

    node scripts/seed-services.js --slug nails
    node scripts/seed-services.js --slug makeup

  Safe to re-run — it only inserts services, it never deletes existing ones.
  Add --dry-run to print what would be inserted without touching Supabase.
*/

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
      args[key] = value;
      if (value !== true) i += 1;
    }
  }
  return args;
}

const NAILS_SERVICES = [
  { cat: 'MANOS', name: 'Manicure clásico', description: 'Limado, cutícula y esmaltado tradicional.', price: 250, duration_minutes: 45, sort_order: 10 },
  { cat: 'MANOS', name: 'Manicure ruso', description: 'Técnica en seco con cutícula impecable.', price: 350, duration_minutes: 60, sort_order: 20 },
  { cat: 'MANOS', name: 'Poligel', description: 'Extensión en poligel con acabado natural.', price: 550, duration_minutes: 90, sort_order: 30 },
  { cat: 'PIES', name: 'Pedicure spa', description: 'Exfoliación, masaje y esmaltado.', price: 380, duration_minutes: 60, sort_order: 40 },
  { cat: 'EXTRAS', name: 'Nail art (por uña)', description: 'Diseños personalizados, precio por uña decorada.', price: 30, duration_minutes: 10, sort_order: 50 }
];

const MAKEUP_SERVICES = [
  { cat: 'MAQUILLAJE', name: 'Maquillaje social', description: 'Maquillaje de día o noche para eventos y fiestas.', price: 450, duration_minutes: 60, sort_order: 10 },
  { cat: 'MAQUILLAJE', name: 'Maquillaje de novia', description: 'Incluye prueba previa. Larga duración.', price: 1800, duration_minutes: 120, sort_order: 20 },
  { cat: 'MAQUILLAJE', name: 'Maquillaje editorial', description: 'Para producciones fotográficas y campañas.', price: 900, duration_minutes: 90, sort_order: 30 },
  { cat: 'PESTAÑAS', name: 'Pestañas clásicas', description: 'Extensión pelo a pelo, efecto natural.', price: 650, duration_minutes: 90, sort_order: 40 },
  { cat: 'PESTAÑAS', name: 'Pestañas volumen ruso', description: 'Abanicos de volumen para mirada intensa.', price: 850, duration_minutes: 120, sort_order: 50 },
  { cat: 'CEJAS', name: 'Diseño de cejas + laminado', description: 'Perfilado, laminado y tinte.', price: 400, duration_minutes: 45, sort_order: 60 }
];

const CATALOGS = { nails: NAILS_SERVICES, makeup: MAKEUP_SERVICES };

async function main() {
  const args = parseArgs(process.argv);
  const slug = args.slug;
  const dryRun = Boolean(args['dry-run']);
  const catalog = CATALOGS[slug];

  if (!slug) {
    console.error('Usage: node scripts/seed-services.js --slug <nails|makeup> [--dry-run]');
    process.exit(1);
  }
  if (!catalog) {
    console.error(`No starter catalog defined for slug "${slug}". Known: ${Object.keys(CATALOGS).join(', ')}. Add your own to this script for other salon types.`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(JSON.stringify(catalog, null, 2));
    console.log(`\nDry run only — ${catalog.length} services would be inserted for "${slug}".`);
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables first.');
    process.exit(1);
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: salon, error: salonErr } = await supabase
    .from('salons')
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle();
  if (salonErr) {
    console.error('Failed to look up salon:', salonErr.message);
    process.exit(1);
  }
  if (!salon) {
    console.error(`No salon found with slug "${slug}". Run sql/schema.sql first (it seeds 'nails' and 'makeup').`);
    process.exit(1);
  }

  const { data: existing, error: existingErr } = await supabase
    .from('services')
    .select('name')
    .eq('salon_id', salon.id);
  if (existingErr) {
    console.error('Failed to check existing services:', existingErr.message);
    process.exit(1);
  }
  const existingNames = new Set((existing || []).map(s => s.name));
  const toInsert = catalog
    .filter(s => !existingNames.has(s.name))
    .map(s => ({ ...s, salon_id: salon.id, active: true, image_url: '' }));

  if (!toInsert.length) {
    console.log(`No new services to add for "${salon.name}" — all starter services already exist.`);
    return;
  }

  const { error } = await supabase.from('services').insert(toInsert);
  if (error) {
    console.error('Failed to insert services:', error.message);
    process.exit(1);
  }

  console.log(`✅ Added ${toInsert.length} starter service(s) to "${salon.name}" (${slug}).`);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
