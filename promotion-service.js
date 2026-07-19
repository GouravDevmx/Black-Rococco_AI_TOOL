const { upsertClientAndGetId, markPersisted } = require('../db');
const { normalizePhone, generateId } = require('../helpers');
const { USE_SUPABASE } = require('../config');
const { applyClientProfilePatch, clientPreferences } = require('../domains/clients');

// Owns everything about identifying, creating and updating the client behind a
// booking. WhatsApp — not the id — is the real-world identity key.
class ClientService {
  constructor(db, salonId) {
    this.db = db;
    this.salonId = salonId;
  }

  findByWhatsapp(whatsapp) {
    const normalized = normalizePhone(whatsapp);
    return this.db.clients.find(c => normalizePhone(c.whatsapp) === normalized) || null;
  }

  /**
   * Returns the client for this booking, creating her if she's new, and folding
   * any supplied preferences into her profile.
   *
   * A brand-new client is written to Postgres IMMEDIATELY rather than waiting
   * for the end-of-request writeDb(): the appointment that follows has a
   * foreign key on client_id, so the client row must genuinely exist first.
   */
  async findOrCreate({ name, whatsapp, profilePatch = {} }) {
    const normalized = normalizePhone(whatsapp);
    let client = this.findByWhatsapp(normalized);
    const isNew = !client;

    if (isNew) {
      this.db.counters.client += 1;
      client = {
        id: generateId(USE_SUPABASE, 'cli', this.db.counters.client),
        name,
        whatsapp: normalized,
        email: '', instagram: '', birthday: '',
        styleChoice: '', colorChoice: '', drinkChoice: '', timePreference: '',
        notes: '', allergies: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      applyClientProfilePatch(client, profilePatch, { allowIdentity: false, onlyNonEmpty: true });
      this.db.clients.push(client);
    } else {
      if (client.name !== name) client.name = name;
      applyClientProfilePatch(client, profilePatch, { allowIdentity: false, onlyNonEmpty: true });
    }

    if (USE_SUPABASE && isNew) {
      // Upserts on (salon_id, whatsapp), so two simultaneous first-time bookings
      // from the same number merge into ONE client instead of erroring. Returns
      // whichever id actually won the race — use that, not the one we generated.
      client.id = await upsertClientAndGetId(this.salonId, client);
      // Already in Postgres. Fold into the read snapshot so the record-level
      // diff in writeDb() UPDATEs rather than INSERTing a duplicate.
      markPersisted(this.db, 'clients', client);
    }

    return { client, isNew };
  }

  preferencesSnapshot(client) {
    return clientPreferences(client);
  }
}

module.exports = { ClientService };
