// Házhozszállítás API: takes orders from the shop and serves them to the staff page.
// Storage: D1 (SQLite). Prices and delivery rules are kept here too, so the server
// never trusts totals or flags sent by the browser.

const BIG_ORDER = 20000, FREE_OVER = 10000, FEE = 490;
const TZ = 'Europe/Budapest';
const ALLOWED_ORIGINS = ['https://ribsbenjo.github.io', 'http://localhost:8765'];
const STATUSES = ['call', 'new', 'packed', 'delivered', 'cancelled'];

// Keep in sync with PLACES / ITEMS in index.html
const PLACES = {
  boly: { name: 'Bóly', days: [1, 2, 3, 4, 5, 6], min: 5000 },
  szajk: { name: 'Szajk', days: [2, 5], min: 8000 }, babarc: { name: 'Babarc', days: [2, 5], min: 8000 },
  borjad: { name: 'Borjád', days: [2, 5], min: 8000 }, monyorod: { name: 'Monyoród', days: [2, 5], min: 8000 },
  szederkeny: { name: 'Szederkény', days: [2, 5], min: 8000 }, nagynyarad: { name: 'Nagynyárád', days: [3, 6], min: 8000 },
  versend: { name: 'Versend', days: [3, 6], min: 8000 }, tottos: { name: 'Töttös', days: [3, 6], min: 8000 },
  pocsa: { name: 'Pócsa', days: [3, 6], min: 8000 },
};
const ITEMS = {
  1: ['🥩', 'Sertéskaraj, csontos', 'kb. 1 kg, saját bontás', 2990], 2: ['🍖', 'Sertéscomb', 'kb. 1 kg', 2690],
  3: ['🍗', 'Csirkemell filé', '1 kg', 2790], 4: ['🌭', 'Házi kolbász', '50 dkg', 2190], 5: ['🥓', 'Füstölt szalonna', '50 dkg', 1890],
  6: ['🥔', 'Burgonya', '2 kg', 790], 7: ['🍅', 'Paradicsom', '1 kg', 1290], 8: ['🧅', 'Vöröshagyma', '1 kg', 490],
  9: ['🍎', 'Alma', '1 kg', 590], 10: ['🫑', 'TV paprika', '50 dkg', 890], 11: ['🍞', 'Fehér kenyér', '1 kg, friss', 890],
  12: ['🥖', 'Kifli', '1 db', 50], 13: ['🥐', 'Kakaós csiga', '1 db', 290], 14: ['🥛', 'Tej 2,8%', '1 l', 399],
  15: ['🥚', 'Tojás', '10 db', 990], 16: ['🧀', 'Trappista sajt', '50 dkg', 2190], 17: ['🧈', 'Vaj', '200 g', 990],
  18: ['🌾', 'Liszt BL55', '1 kg', 299], 19: ['🍚', 'Rizs', '1 kg', 690], 20: ['🫙', 'Napraforgóolaj', '1 l', 799],
  21: ['🍬', 'Kristálycukor', '1 kg', 449], 22: ['☕', 'Őrölt kávé', '250 g', 1690], 23: ['🧻', 'Toalettpapír', '8 tekercs', 1490],
  24: ['🧼', 'Mosogatószer', '500 ml', 590], 25: ['🧺', 'Mosópor', '20 mosás', 2990],
};

const normPhone = p => String(p || '').replace(/\D/g, '').replace(/^(36|06)/, '').slice(-9);
const ft = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + '\u00a0Ft';
const clip = (s, n) => String(s ?? '').trim().slice(0, n);

// --- time helpers (delivery days are Budapest calendar days, stored as that day's 00:00 epoch ms)
function bpParts(ms) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', timeZoneName: 'shortOffset' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  const off = (p.timeZoneName.match(/GMT([+-]\d+)?/)[1] || '0') * 1;
  return { y: +p.year, m: +p.month, d: +p.day, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), off };
}
const bpMidnight = (ms, addDays = 0) => { const p = bpParts(ms); const t = Date.UTC(p.y, p.m - 1, p.d + addDays) - p.off * 36e5; return t - (bpParts(t).off - p.off) * 36e5; };

// --- auth: stateless HMAC token "expiry.signature"
const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hmacKey = secret => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
async function sign(env, exp) { return b64(await crypto.subtle.sign('HMAC', await hmacKey(env.TOKEN_SECRET), enc.encode(String(exp)))); }
async function authed(req, env) {
  const t = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
  const [exp, sig] = t.split('.');
  return !!exp && +exp > Date.now() && sig === await sign(env, exp);
}
async function safeEqual(a, b) {
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', enc.encode(String(s)))));
  return b64(x) === b64(y);
}

// --- responses
function cors(req) {
  const o = req.headers.get('Origin');
  return { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0], 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Vary': 'Origin' };
}
const json = (req, data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(req) } });

// --- data
const SCHEMA = `CREATE TABLE IF NOT EXISTS orders (no TEXT PRIMARY KEY, created INTEGER, day INTEGER, place TEXT, name TEXT, addr TEXT, phone TEXT, phone_norm TEXT, pay TEXT, note TEXT, lines TEXT, sub INTEGER, fee INTEGER, total INTEGER, status TEXT, updated INTEGER, demo INTEGER DEFAULT 0)`;
const rowOut = r => ({ ...r, lines: JSON.parse(r.lines), demo: !!r.demo });
const isRegular = async (env, phone) => !!(await env.DB.prepare(`SELECT 1 FROM orders WHERE phone_norm = ? AND status = 'delivered' LIMIT 1`).bind(normPhone(phone)).first());

function insert(env, o) {
  return env.DB.prepare(`INSERT INTO orders (no, created, day, place, name, addr, phone, phone_norm, pay, note, lines, sub, fee, total, status, updated, demo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(o.no, o.created, o.day, o.place, o.name, o.addr, o.phone, normPhone(o.phone), o.pay, o.note, JSON.stringify(o.lines), o.sub, o.fee, o.total, o.status, o.created, o.demo ? 1 : 0);
}

function demoOrders() {
  const now = Date.now(), day = n => bpMidnight(now, n);
  const L = (id, q) => { const [e, n, u, p] = ITEMS[id]; return { e, n, u, p, q }; };
  const mk = (no, dn, place, name, addr, phone, pay, lines, status, note = '') => {
    const sub = lines.reduce((a, l) => a + l.p * l.q, 0), fee = sub >= FREE_OVER ? 0 : FEE;
    return { no, created: day(dn) - 15 * 36e5, day: day(dn), place, name, addr, phone, pay, note, lines, sub, fee, total: sub + fee, status, demo: true };
  };
  return [
    mk('HSZ-4821', 0, 'Szajk', 'Horváth Gábor', 'Szajk, Petőfi u. 31.', '06 70 555 1290', 'kartya', [L(1, 3), L(4, 2), L(5, 2), L(16, 1), L(25, 1), L(22, 1)], 'call', 'Disznóvágás utáni hétre kérem.'),
    mk('HSZ-4817', 0, 'Bóly', 'Kovács Mária', 'Bóly, Rákóczi u. 12.', '06 30 412 7781', 'kp', [L(11, 1), L(14, 2), L(15, 1), L(6, 1), L(1, 1), L(16, 1), L(9, 1)], 'new', 'A kapucsengő nem működik, kopogjanak.'),
    mk('HSZ-4815', 0, 'Babarc', 'Schmidt János', 'Babarc, Fő u. 8.', '06 20 318 4402', 'kp', [L(3, 4), L(1, 3), L(2, 2), L(20, 2)], 'new'),
    mk('HSZ-4809', 0, 'Bóly', 'Takács Erzsébet', 'Bóly, Ady E. u. 4.', '06 30 977 2015', 'kp', [L(12, 10), L(14, 2), L(17, 1), L(7, 1), L(10, 1), L(13, 4)], 'packed'),
    mk('HSZ-4824', 1, 'Nagynyárád', 'Fehér Anna', 'Nagynyárád, Kossuth u. 17.', '06 70 203 6618', 'kartya', [L(6, 2), L(8, 1), L(18, 2), L(21, 2), L(19, 1), L(15, 2), L(23, 1), L(3, 1)], 'new'),
    mk('HSZ-4790', -3, 'Babarc', 'Schmidt János', 'Babarc, Fő u. 8.', '06 20 318 4402', 'kp', [L(1, 2), L(11, 2), L(14, 4)], 'delivered'),
    mk('HSZ-4786', -4, 'Bóly', 'Kovács Mária', 'Bóly, Rákóczi u. 12.', '06 30 412 7781', 'kp', [L(11, 1), L(15, 1), L(9, 2), L(16, 1)], 'delivered'),
    mk('HSZ-4779', -4, 'Versend', 'Nagy Péter', 'Versend, Arany J. u. 2.', '06 30 640 8890', 'kp', [L(1, 5), L(2, 4), L(25, 2)], 'cancelled', 'Visszahívásra nem vette fel, a szám nem létezik.'),
  ];
}
async function seed(env, wipe) {
  const stmts = [env.DB.prepare(SCHEMA)];
  if (wipe) stmts.push(env.DB.prepare('DELETE FROM orders'));
  await env.DB.batch(stmts);
  if (!wipe && (await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first()).n > 0) return;
  await env.DB.batch(demoOrders().map(o => insert(env, o)));
}

// --- handlers
async function createOrder(req, env) {
  const b = await req.json().catch(() => null);
  if (!b) return json(req, { error: 'Hibás kérés.' }, 400);
  const pl = PLACES[b.place];
  if (!pl) return json(req, { error: 'Ismeretlen település.' }, 400);
  const name = clip(b.name, 80), addr = clip(b.addr, 160), phone = clip(b.phone, 30), note = clip(b.note, 300);
  if (!name || !addr || normPhone(phone).length !== 9) return json(req, { error: 'Kérjük, adja meg a nevét, címét és telefonszámát.' }, 400);
  const pay = b.pay === 'kartya' ? 'kartya' : 'kp';

  const lines = [];
  for (const [id, q] of Object.entries(b.cart || {})) {
    const it = ITEMS[id], n = Math.floor(+q);
    if (!it || !(n >= 1 && n <= 50)) return json(req, { error: 'Hibás tétel a kosárban.' }, 400);
    lines.push({ e: it[0], n: it[1], u: it[2], p: it[3], q: n });
  }
  if (!lines.length) return json(req, { error: 'Üres a kosár.' }, 400);
  const sub = lines.reduce((a, l) => a + l.p * l.q, 0), fee = sub >= FREE_OVER ? 0 : FEE, total = sub + fee;
  if (sub < pl.min) return json(req, { error: `A legkisebb rendelés ide ${ft(pl.min)}.` }, 400);

  const now = Date.now(), day = +b.day;
  if (!(day >= bpMidnight(now) && day <= bpMidnight(now, 21)) || bpMidnight(day) !== day || !pl.days.includes(bpParts(day).wd))
    return json(req, { error: 'Erre a napra nem szállítunk ide. Kérjük, válasszon másik napot.' }, 400);

  const status = total > BIG_ORDER && !(await isRegular(env, phone)) ? 'call' : 'new';
  for (let i = 0; i < 5; i++) {
    const no = 'HSZ-' + (10000 + Math.floor(Math.random() * 90000));
    try {
      await insert(env, { no, created: now, day, place: pl.name, name, addr, phone, pay, note, lines, sub, fee, total, status }).run();
      return json(req, { no, status, call: status === 'call', total });
    } catch (e) { if (!String(e).includes('UNIQUE')) throw e; }
  }
  return json(req, { error: 'Próbálja újra.' }, 500);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    try {
      await seed(env, false);

      if (path === '/api/orders' && req.method === 'POST') return await createOrder(req, env);

      if (path === '/api/check' && req.method === 'GET') {
        const phone = url.searchParams.get('phone'), total = +url.searchParams.get('total') || 0;
        return json(req, { call: total > BIG_ORDER && normPhone(phone).length === 9 && !(await isRegular(env, phone)) });
      }

      if (path === '/api/login' && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        if (!(await safeEqual(b.password || '', env.ADMIN_PASSWORD))) return json(req, { error: 'Hibás jelszó.' }, 401);
        const exp = Date.now() + 12 * 36e5;
        return json(req, { token: `${exp}.${await sign(env, exp)}`, exp });
      }

      if (path.startsWith('/api/admin/')) {
        if (!(await authed(req, env))) return json(req, { error: 'Jelentkezzen be újra.' }, 401);
        if (path === '/api/admin/orders' && req.method === 'GET') {
          const { results } = await env.DB.prepare('SELECT * FROM orders ORDER BY created DESC LIMIT 500').all();
          return json(req, { orders: results.map(rowOut), now: Date.now(), today: bpMidnight(Date.now()) });
        }
        const m = path.match(/^\/api\/admin\/orders\/(HSZ-\d{4,5})$/);
        if (m && req.method === 'PATCH') {
          const { status } = await req.json().catch(() => ({}));
          if (!STATUSES.includes(status)) return json(req, { error: 'Hibás állapot.' }, 400);
          const r = await env.DB.prepare('UPDATE orders SET status = ?, updated = ? WHERE no = ?').bind(status, Date.now(), m[1]).run();
          return r.meta.changes ? json(req, { ok: true }) : json(req, { error: 'Nincs ilyen rendelés.' }, 404);
        }
        if (path === '/api/admin/reset' && req.method === 'POST') { await seed(env, true); return json(req, { ok: true }); }
      }
      return json(req, { error: 'Nem található.' }, 404);
    } catch (e) {
      console.error(e);
      return json(req, { error: 'Szerverhiba, próbálja újra.' }, 500);
    }
  },
};
