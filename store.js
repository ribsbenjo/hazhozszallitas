// Shared order store for the shop (index.html) and the staff page (admin.html).
// There is no server yet: orders live in this browser's localStorage, so the two
// pages only see each other's data on the same device and browser.
const STORE_KEY = 'hsz_orders';
const BIG_ORDER = 20000; // above this, a first-time customer gets a confirmation call

const normPhone = p => (p || '').replace(/\D/g, '').replace(/^(36|06)/, '').slice(-9);

// Regular = this phone number already has a delivered order.
const isRegular = (orders, phone) => orders.some(o => o.status === 'delivered' && normPhone(o.phone) === normPhone(phone));
const needsCall = (orders, phone, total) => total > BIG_ORDER && !isRegular(orders, phone);

function loadOrders() {
  try { const o = JSON.parse(localStorage.getItem(STORE_KEY)); if (Array.isArray(o)) return o; } catch (e) {}
  const d = demoOrders(); saveOrders(d); return d;
}
function saveOrders(o) { try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch (e) {} }

function demoOrders() {
  const day = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return +d; };
  const L = (e, n, u, p, q) => ({ e, n, u, p, q });
  const mk = (no, dayN, place, name, addr, phone, pay, lines, status, note = '') => {
    const sub = lines.reduce((a, l) => a + l.p * l.q, 0), fee = sub >= 10000 ? 0 : 490;
    return { no, created: day(dayN) - 864e5 + 9 * 36e5, day: day(dayN), place, name, addr, phone, pay, note, lines, sub, fee, total: sub + fee, status, demo: true };
  };
  return [
    mk('HSZ-4821', 0, 'Szajk', 'Horváth Gábor', 'Szajk, Petőfi u. 31.', '06 70 555 1290', 'kartya', [
      L('🥩', 'Sertéskaraj, csontos', 'kb. 1 kg, saját bontás', 2990, 3), L('🌭', 'Házi kolbász', '50 dkg', 2190, 2), L('🥓', 'Füstölt szalonna', '50 dkg', 1890, 2),
      L('🧀', 'Trappista sajt', '50 dkg', 2190, 1), L('🧺', 'Mosópor', '20 mosás', 2990, 1), L('☕', 'Őrölt kávé', '250 g', 1690, 1)], 'call', 'Disznóvágás utáni hétre kérem.'),
    mk('HSZ-4817', 0, 'Bóly', 'Kovács Mária', 'Bóly, Rákóczi u. 12.', '06 30 412 7781', 'kp', [
      L('🍞', 'Fehér kenyér', '1 kg, friss', 890, 1), L('🥛', 'Tej 2,8%', '1 l', 399, 2), L('🥚', 'Tojás', '10 db', 990, 1), L('🥔', 'Burgonya', '2 kg', 790, 1),
      L('🥩', 'Sertéskaraj, csontos', 'kb. 1 kg, saját bontás', 2990, 1), L('🧀', 'Trappista sajt', '50 dkg', 2190, 1), L('🍎', 'Alma', '1 kg', 590, 1)], 'new', 'A kapucsengő nem működik, kopogjanak.'),
    mk('HSZ-4815', 0, 'Babarc', 'Schmidt János', 'Babarc, Fő u. 8.', '06 20 318 4402', 'kp', [
      L('🍗', 'Csirkemell filé', '1 kg', 2790, 4), L('🥩', 'Sertéskaraj, csontos', 'kb. 1 kg, saját bontás', 2990, 3), L('🍖', 'Sertéscomb', 'kb. 1 kg', 2690, 2),
      L('🫙', 'Napraforgóolaj', '1 l', 799, 2)], 'new'),
    mk('HSZ-4809', 0, 'Bóly', 'Takács Erzsébet', 'Bóly, Ady E. u. 4.', '06 30 977 2015', 'kp', [
      L('🥖', 'Kifli', '1 db', 50, 10), L('🥛', 'Tej 2,8%', '1 l', 399, 2), L('🧈', 'Vaj', '200 g', 990, 1), L('🍅', 'Paradicsom', '1 kg', 1290, 1), L('🫑', 'TV paprika', '50 dkg', 890, 1),
      L('🥐', 'Kakaós csiga', '1 db', 290, 4)], 'packed'),
    mk('HSZ-4824', 1, 'Nagynyárád', 'Fehér Anna', 'Nagynyárád, Kossuth u. 17.', '06 70 203 6618', 'kartya', [
      L('🥔', 'Burgonya', '2 kg', 790, 2), L('🧅', 'Vöröshagyma', '1 kg', 490, 1), L('🌾', 'Liszt BL55', '1 kg', 299, 2), L('🍬', 'Kristálycukor', '1 kg', 449, 2),
      L('🍚', 'Rizs', '1 kg', 690, 1), L('🥚', 'Tojás', '10 db', 990, 2), L('🧻', 'Toalettpapír', '8 tekercs', 1490, 1), L('🍗', 'Csirkemell filé', '1 kg', 2790, 1)], 'new'),
    mk('HSZ-4790', -3, 'Babarc', 'Schmidt János', 'Babarc, Fő u. 8.', '06 20 318 4402', 'kp', [
      L('🥩', 'Sertéskaraj, csontos', 'kb. 1 kg, saját bontás', 2990, 2), L('🍞', 'Fehér kenyér', '1 kg, friss', 890, 2), L('🥛', 'Tej 2,8%', '1 l', 399, 4)], 'delivered'),
    mk('HSZ-4786', -4, 'Bóly', 'Kovács Mária', 'Bóly, Rákóczi u. 12.', '06 30 412 7781', 'kp', [
      L('🍞', 'Fehér kenyér', '1 kg, friss', 890, 1), L('🥚', 'Tojás', '10 db', 990, 1), L('🍎', 'Alma', '1 kg', 590, 2), L('🧀', 'Trappista sajt', '50 dkg', 2190, 1)], 'delivered'),
    mk('HSZ-4779', -4, 'Versend', 'Nagy Péter', 'Versend, Arany J. u. 2.', '06 30 640 8890', 'kp', [
      L('🥩', 'Sertéskaraj, csontos', 'kb. 1 kg, saját bontás', 2990, 5), L('🍖', 'Sertéscomb', 'kb. 1 kg', 2690, 4), L('🧺', 'Mosópor', '20 mosás', 2990, 2)], 'cancelled', 'Visszahívásra nem vette fel, a szám nem létezik.'),
  ];
}
