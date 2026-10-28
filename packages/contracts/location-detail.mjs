// Public, unauthenticated Streetli location projection behind the inline detail panel.
// Upstream marks this route `publicRead` and never forwards an Authorization header,
// so this file must never add credentials or request a private field.
export const LOCATION_DETAIL_BASE = 'https://us-central1-streetli.cloudfunctions.net/sheetsAwsProxy/location-modal-details/';

const LOCATION_ID = /^[A-Za-z0-9_-]{1,100}$/;
const ISO_KEY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const MAX_TEXT = 2000;
const MAX_SERVICES = 25;
const MAX_PHONES = 10;

export function buildLocationDetailUrl(locationId) {
  if (!LOCATION_ID.test(String(locationId || ''))) return null;
  return `${LOCATION_DETAIL_BASE}${encodeURIComponent(locationId)}`;
}

// Upstream versions many fields as { <ISO timestamp>: value }; the newest key wins.
// A plain value passes through unchanged, and an all-timestamp map may resolve to null.
export function latestValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value ?? null;
  const keys = Object.keys(value);
  if (!keys.length || !keys.every(key => ISO_KEY.test(key))) return value;
  return value[keys.reduce((newest, key) => (key > newest ? key : newest))] ?? null;
}

// Upstream free text may carry markup, e.g. an <a href="tel:..."> inside a service note.
// Tags are removed here so no renderer downstream can be handed markup to inject.
// Entities are decoded BEFORE stripping: decoding afterwards would turn an escaped
// "&lt;img onerror=...&gt;" back into a live tag. Any stray bracket left over is dropped,
// so this function cannot return a value containing < or >.
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const clean = value => String(value)
  .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, match => ENTITIES[match])
  .replace(/<[^>]*>/g, ' ')
  .replace(/[<>]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const text = value => {
  const resolved = latestValue(value);
  if (typeof resolved !== 'string') return null;
  const cleaned = clean(resolved);
  return cleaned ? cleaned.slice(0, MAX_TEXT) : null;
};

export function projectLocationDetail(payload) {
  const shape = payload?.standardShape;
  const location = shape && typeof shape.locations === 'object' ? Object.values(shape.locations)[0] : null;
  if (!location || typeof location !== 'object') return null;
  const address = location.address && typeof location.address === 'object' ? location.address : {};
  const entries = source => (source && typeof source === 'object' ? Object.values(source) : []);
  return {
    name: text(location.name),
    // Organizations arrive keyed by location and then by organization id, so look one level in.
    organization: entries(shape.organizations)
      .flatMap(group => (group && typeof group === 'object' && !Array.isArray(group) ? Object.values(group) : [group]))
      .map(value => text(value)).find(Boolean) || null,
    neighborhood: text(location.neighborhood),
    address: {
      line1: text(address.line1), city: text(address.city),
      state: text(address.state), postalCode: text(address.postalCode),
    },
    phones: entries(shape.phones).slice(0, MAX_PHONES).map(phone => ({
      number: text(phone?.phoneNumber), type: text(phone?.type), extension: text(phone?.extension),
    })).filter(phone => phone.number),
    website: text(location.url),
    email: text(location.email),
    closed: location.closed === true,
    closureMessage: text(location.closureMessage),
    lastValidatedAt: text(location.locationLastValidatedAt),
    updatedAt: text(location.locationRecordUpdatedAtLatest),
    slug: text(location.slug),
    services: entries(shape.services).slice(0, MAX_SERVICES).map(service => ({
      name: text(service?.serviceName),
      description: text(service?.serviceDescription),
      additionalInfo: text(service?.serviceAdditionalInfo),
    })).filter(service => service.name || service.description),
  };
}
