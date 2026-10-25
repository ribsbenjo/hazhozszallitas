// Client for the Házhozszállítás API (Cloudflare Worker + D1, source in api/).
// The shop and the staff page both talk to it, so orders from any phone reach the shop.
const API = 'https://hazhozszallitas-api.ribsbenjo.workers.dev/api';
const BIG_ORDER = 20000; // above this, a first-time customer gets a confirmation call (rule enforced by the API)

const normPhone = p => (p || '').replace(/\D/g, '').replace(/^(36|06)/, '').slice(-9);

async function api(path, { method = 'GET', body, token } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw Object.assign(new Error('Nincs internetkapcsolat, vagy a szerver nem érhető el. Próbálja újra.'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Hiba történt, próbálja újra.'), { status: res.status });
  return data;
}
