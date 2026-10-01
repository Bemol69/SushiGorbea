// ===== CONFIGURACIÓN =====
// Datos del local: los inserta scripts/build.mjs desde tienda.config.json y data/ajustes.json
const TIENDA = %%TIENDA_JSON%%;
const WHATSAPP_NUMBER = TIENDA.whatsapp;

const PAGOS = {
  efectivo: { label: 'Efectivo', msg: '💵 *Pago:* Efectivo' },
  transferencia: { label: 'Transferencia', msg: '🏦 *Pago:* Transferencia' },
  tarjeta: { label: 'Tarjeta (en local)', msg: '💳 *Pago:* Tarjeta en el local' },
};

// Productos, categorías, códigos y comunas se editan en /admin y se publican juntos en data/catalogo.json
let PRODUCTS = [];
let FILTERS = [['todos', 'Todo']];
let CUPONES = [];
let ZONAS = [];
let OTRA_COMUNA = true;

const SORTS = {
  destacados: null,
  'precio-asc': (a, b) => a.price - b.price,
  'precio-desc': (a, b) => b.price - a.price,
};
const MAX_QTY = 20;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ===== UTILIDADES =====
const clp = (n) => '$' + Math.round(n).toLocaleString('es-CL');
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const findProduct = (id) => PRODUCTS.find((p) => p.id === id);
// Se usa api.whatsapp.com y no wa.me: la redirección de wa.me rompe los emojis (llegan como �)
const waUrl = (text) =>
  `https://api.whatsapp.com/send?phone=${WHATSAPP_NUMBER}${text ? '&text=' + encodeURIComponent(text) : ''}`;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('is-on'), 2400);
}

// Flyers (verticales o cuadrados) se muestran completos en el marco 4:3, sobre un fondo difuminado
function fitImage(img) {
  const box = img.closest('.ticket__img, .pm__frame');
  if (!box || !img.naturalWidth || img.classList.contains('alt')) return;
  const r = img.naturalHeight / img.naturalWidth;
  const fit = r > 0.95;
  box.classList.toggle('is-fit', fit);
  if (fit) box.style.setProperty('--fit-bg', `url("${img.currentSrc || img.src}")`);
}
document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') fitImage(e.target); }, true);
const fitAll = (root) => root.querySelectorAll('.ticket__img img, .pm__frame img').forEach((img) => { if (img.complete) fitImage(img); });
fitAll(document);

function lockScroll() {
  const open = ['#productModal', '#bag', '#promoModal'].some((s) => { const el = $(s); return el && el.classList.contains('is-open'); });
  document.body.style.overflow = open ? 'hidden' : '';
}

// ===== HORARIO: abierto / cerrado según la hora de Santiago =====
const toMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
function ahoraChile() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { dia, min: Number(get('hour')) * 60 + Number(get('minute')) };
}
const cierreDe = (dia) => (dia === 5 || dia === 6 ? TIENDA.hora_cierra_finde : TIENDA.hora_cierra);
function estado() {
  const { dia, min } = ahoraChile();
  const abre = toMin(TIENDA.hora_abre);
  const cierra = toMin(cierreDe(dia));
  const abierto = min >= abre && min < cierra;
  return { dia, min, abre, cierra, abierto, antes: min < abre };
}
function pintarEstado() {
  const e = estado();
  const txt = e.abierto
    ? `Abierto · cierra ${cierreDe(e.dia)}`
    : e.antes ? `Cerrado · abre ${TIENDA.hora_abre}` : `Cerrado · abre mañana ${TIENDA.hora_abre}`;
  const st = $('[data-status]');
  if (st) {
    st.classList.toggle('is-open', e.abierto);
    st.classList.toggle('is-closed', !e.abierto);
    st.querySelector('.status__txt').textContent = txt;
  }
  const neon = $('[data-status-neon]');
  if (neon) {
    neon.classList.toggle('is-closed', !e.abierto);
    neon.querySelector('.neon__sign').textContent = e.abierto ? 'Abierto' : 'Cerrado';
    neon.querySelector('.neon__sub').textContent = txt.split(' · ')[1] || '';
  }
  document.querySelectorAll('.hours tr').forEach((tr) => {
    const d = tr.dataset.days;
    tr.classList.toggle('is-today', d === 'all' || (d || '').split(' ').includes(String(e.dia)));
  });
  return e;
}
pintarEstado();
setInterval(pintarEstado, 60000);

// ===== CATÁLOGO =====
const grid = $('#productGrid');
const filters = $('#filters');
let currentCat = 'todos';

function renderFilters(active) {
  const count = (k) => (k === 'todos' ? PRODUCTS.length : PRODUCTS.filter((p) => p.tags.includes(k)).length);
  filters.innerHTML = FILTERS
    .filter(([k]) => count(k) > 0) // oculta categorías vacías
    .map(([k, label]) => `<button class="tab${k === active ? ' is-active' : ''}" type="button" role="tab" aria-selected="${k === active}" data-cat="${esc(k)}">${esc(label)}<span class="tab__n">${count(k)}</span></button>`)
    .join('');
}

// Misma comanda que escribe scripts/build.mjs en el HTML (para Google): si cambias una, cambia la otra
const card = (p, i) => `
    <article class="ticket${p.agotado ? ' is-soldout' : ''}" data-id="${esc(p.id)}" data-cats="${esc(p.tags.join(' '))}" style="--i:${i}">
      <div class="ticket__paper">
        <span class="ticket__clip" aria-hidden="true"></span>
        <header class="ticket__head">
          <span class="ticket__no">Nº ${pad(p.no)}</span>
          <span class="ticket__cat">${esc(p.cat)}</span>
        </header>
        <button class="ticket__img" type="button" data-view="${esc(p.id)}" aria-label="Ver ${esc(p.name)}">
          ${p.agotado ? '<span class="stamp stamp--out">Agotado</span>' : p.badge ? `<span class="stamp">${esc(p.badge)}</span>` : ''}
          <img src="${esc(p.thumb)}" alt="${esc(p.name)}" loading="lazy" decoding="async">
          ${p.thumbs[1] ? `<img class="alt" src="${esc(p.thumbs[1])}" alt="" loading="lazy" decoding="async">` : ''}
        </button>
        <h3 class="ticket__name">${esc(p.name)}${p.pcs ? ` <small>${esc(p.pcs)}</small>` : ''}</h3>
        ${p.list.length ? `<ul class="ticket__list">${p.list.map((t) => `<li>${esc(t)}</li>`).join('')}${p.list.length > 3 ? `<li class="more">+${p.list.length - 3} rolls más</li>` : ''}</ul>` : ''}
        ${p.desc ? `<p class="ticket__desc">${esc(p.desc)}</p>` : ''}
        ${p.vars ? `<p class="ticket__var">${esc(p.vars.titulo)}: ${p.vars.opciones.map((o) => esc(o.nombre.split(' · ')[0])).join(' / ')}</p>` : ''}
        <footer class="ticket__foot">
          <span class="ticket__price${p.price ? '' : ' is-ask'}">${p.price ? `${p.desde ? '<small>desde</small> ' : ''}${clp(p.price)}` : 'Consultar'}</span>
          ${p.agotado
            ? `<a class="btn btn--line btn--sm" target="_blank" rel="noopener" href="${esc(waUrl(`¡Hola Gorbea! ¿Hoy tienen ${p.name}?`))}">Consultar</a>`
            : `<button class="btn btn--sea btn--sm" type="button" data-${p.vars ? 'view' : 'add'}="${esc(p.id)}">${p.vars ? 'Elegir' : 'Agregar'}</button>`}
        </footer>
      </div>
    </article>`;

function renderProducts(cat = currentCat) {
  currentCat = cat;
  let list = cat === 'todos' ? PRODUCTS : PRODUCTS.filter((p) => p.tags.includes(cat));
  const sort = SORTS[$('#sort').value];
  if (sort) list = [...list].sort(sort);
  grid.innerHTML = list.map(card).join('');
  markFeature();
  fitAll(grid);
  observeTickets();
}

// La primera comanda de "Todo" (sin ordenar por precio) se destaca a dos columnas en escritorio
function markFeature() {
  const tickets = grid.querySelectorAll('.ticket');
  tickets.forEach((t, i) => t.classList.toggle('is-feature', i === 0 && currentCat === 'todos' && $('#sort').value === 'destacados'));
}

filters.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cat]');
  if (!btn) return;
  filters.querySelectorAll('.tab').forEach((b) => { const on = b === btn; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); });
  if (PRODUCTS.length) renderProducts(btn.dataset.cat);
  else { // catálogo aún sin cargar: filtra el HTML que dejó el build
    currentCat = btn.dataset.cat;
    grid.querySelectorAll('.ticket').forEach((t) => t.classList.toggle('is-hidden', currentCat !== 'todos' && !t.dataset.cats.split(' ').includes(currentCat)));
  }
});
$('#sort').addEventListener('change', () => { if (PRODUCTS.length) renderProducts(); });

// Las comandas caen al riel cuando entran en pantalla, en cascada
let ticketIO = null;
function observeTickets() {
  const tickets = grid.querySelectorAll('.ticket:not(.is-in)');
  if (reduceMotion || !('IntersectionObserver' in window)) { tickets.forEach((t) => t.classList.add('is-in')); return; }
  if (!ticketIO) {
    ticketIO = new IntersectionObserver((entries) => {
      let k = 0;
      entries.filter((en) => en.isIntersecting).forEach((en) => {
        en.target.style.setProperty('--d', k++);
        en.target.classList.add('is-in');
        ticketIO.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  }
  tickets.forEach((t) => ticketIO.observe(t));
}

// ===== FICHA DE PRODUCTO =====
const pModal = $('#productModal');
let current = null;
let photo = 0;
let pick = { variant: '', qty: 1 };
let lastFocus = null;

const precioDe = (p, variant) => {
  const o = p.vars && p.vars.opciones.find((x) => x.nombre === variant);
  return o && o.precio ? o.precio : p.price;
};

function showPhoto(i) {
  const g = current.gallery;
  photo = (i + g.length) % g.length;
  $('#pmImg').src = g[photo];
  fitImage($('#pmImg'));
  $('#pmThumbs').querySelectorAll('button').forEach((b, k) => b.classList.toggle('is-active', k === photo));
}

function renderVars() {
  $('#pmVars').innerHTML = current.vars.opciones
    .map((o) => `<button type="button" role="radio" aria-checked="${o.nombre === pick.variant}" data-variant="${esc(o.nombre)}">${esc(o.nombre)}${current.desde ? ` <small>${clp(o.precio)}</small>` : ''}</button>`)
    .join('');
  $('#pmPrice').textContent = pick.variant || !current.desde ? clp(precioDe(current, pick.variant)) : `Desde ${clp(current.price)}`;
}

function openProduct(id) {
  const p = findProduct(id);
  if (!p) return;
  lastFocus = document.activeElement;
  current = p;
  pick = { variant: p.vars && p.vars.opciones.length === 1 ? p.vars.opciones[0].nombre : '', qty: 1 };

  $('#pmImg').alt = p.name;
  $('#pmThumbs').innerHTML = p.gallery.length > 1
    ? p.thumbs.map((src, i) => `<button type="button" data-photo="${i}" aria-label="Foto ${i + 1}"><img src="${esc(src)}" alt="" loading="lazy"></button>`).join('')
    : '';
  showPhoto(0);
  $('#pmCat').textContent = `Nº ${pad(p.no)} · ${p.cat}`;
  $('#pmName').textContent = p.name;
  $('#pmPcs').textContent = p.pcs;
  $('#pmPrice').textContent = p.price ? clp(p.price) : 'Consultar precio';
  $('#pmList').innerHTML = p.list.map((t) => `<li>${esc(t)}</li>`).join('');
  $('#pmDesc').textContent = p.desc;
  $('#pmVarsWrap').hidden = !p.vars;
  if (p.vars) { $('#pmVarsTitle').textContent = p.vars.titulo; renderVars(); }
  $('#pmQty').textContent = '1';
  $('#pmError').hidden = true;
  $('#pmAdd').hidden = p.agotado;
  document.querySelector('.pm__buy .qty').hidden = p.agotado;
  $('#pmAsk').href = waUrl(`¡Hola Gorbea! Quiero consultar por ${p.name}${p.pcs ? ` (${p.pcs})` : ''} 🍣`);

  pModal.classList.add('is-open');
  pModal.setAttribute('aria-hidden', 'false');
  lockScroll();
  $('#pmAdd').hidden ? $('#pmAsk').focus() : pModal.querySelector('.modal__close').focus();
}

function closeProduct() {
  if (!pModal.classList.contains('is-open')) return;
  pModal.classList.remove('is-open');
  pModal.setAttribute('aria-hidden', 'true');
  lockScroll();
  if (lastFocus && !bagEl.classList.contains('is-open')) lastFocus.focus();
}

pModal.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-close]')) { closeProduct(); return; }
  const thumb = t.closest('[data-photo]');
  if (thumb) showPhoto(Number(thumb.dataset.photo));
  const v = t.closest('[data-variant]');
  if (v) {
    pick.variant = v.dataset.variant;
    $('#pmError').hidden = true;
    renderVars();
  }
  const q = t.closest('[data-qty]');
  if (q) {
    pick.qty = Math.min(MAX_QTY, Math.max(1, pick.qty + Number(q.dataset.qty)));
    $('#pmQty').textContent = pick.qty;
  }
});

// Deslizar la foto con el dedo en el celular
let touchX = null;
$('#pmImg').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
$('#pmImg').addEventListener('touchend', (e) => {
  if (touchX === null || current.gallery.length < 2) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 40) showPhoto(photo + (dx < 0 ? 1 : -1));
  touchX = null;
});

$('#pmAdd').addEventListener('click', () => {
  if (current.vars && !pick.variant) {
    $('#pmError').textContent = `Elige ${current.vars.titulo.toLowerCase()} para agregarlo a tu comanda.`;
    $('#pmError').hidden = false;
    return;
  }
  flyFrom($('#pmAdd'));
  addToBag(current.id, pick.variant, pick.qty);
  closeProduct();
  toast(`${current.name}${pick.variant ? ` · ${pick.variant.split(' · ')[0]}` : ''} va a la comanda 🍣`);
});

// ===== COMANDA (BOLSA) =====
// Se guarda en este navegador para no perderla al recargar la página
const bagEl = $('#bag');
const BAG_KEY = 'gsComanda';
let BAG = [];
try { BAG = JSON.parse(localStorage.getItem(BAG_KEY) || '[]'); } catch (e) { BAG = []; }
if (!Array.isArray(BAG)) BAG = [];

function saveBag() {
  try { localStorage.setItem(BAG_KEY, JSON.stringify(BAG)); } catch (e) {}
}

let lastAdded = null;
function addToBag(id, variant, qty) {
  const line = BAG.find((l) => l.id === id && l.variant === variant);
  if (line) line.qty = Math.min(MAX_QTY, line.qty + qty);
  else BAG.push({ id, variant, qty });
  lastAdded = `${id}|${variant}`;
  saveBag();
  renderBag(true);
}

// Agregar directo desde la comanda (productos sin opciones)
function quickAdd(id, from) {
  const p = findProduct(id);
  if (!p) return;
  if (p.vars) { openProduct(id); return; }
  if (p.agotado) return;
  flyFrom(from);
  addToBag(id, '', 1);
  toast(`${p.name} va a la comanda 🍣`);
}

// Productos borrados o agotados desde el panel se descartan solos; una opción que ya no existe se marca.
const bagLines = () => BAG
  .map((l) => ({ ...l, p: findProduct(l.id) }))
  .filter((l) => l.p && !l.p.agotado)
  .map((l) => ({ ...l, sinOpcion: !!l.p.vars && !l.p.vars.opciones.some((o) => o.nombre === l.variant), precio: precioDe(l.p, l.variant) }));
const bagTotal = () => bagLines().reduce((s, l) => s + l.precio * l.qty, 0);

// ===== CÓDIGOS DE DESCUENTO =====
// Se crean en /admin → Códigos de descuento. El catálogo trae solo su huella SHA-256 (no el código en texto):
// aquí se calcula la huella de lo que escribe el cliente y se compara. CUPON_SAL debe coincidir con scripts/build.mjs.
const CUPON_SAL = 'gorbea-sushi:';
const CUPON_KEY = 'gsCupon';
let CUPON = null;
const normCodigo = (c) => String(c || '').toUpperCase().replace(/\s+/g, '');
const hoyChile = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const fechaCL = (iso) => iso.split('-').reverse().join('-');

async function huella(codigo) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(CUPON_SAL + normCodigo(codigo)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const cuponTexto = (c) => (c.tipo === 'monto' ? `${clp(c.valor)} de descuento` : `${c.valor}% de descuento`);
const aplicaA = (c, id) => !c.productos || c.productos.includes(id);

function descuento() {
  if (!CUPON) return null;
  const c = CUPON.c;
  const base = bagLines().filter((l) => l.precio && aplicaA(c, l.id)).reduce((s, l) => s + l.precio * l.qty, 0);
  if (!base) return { c, monto: 0, motivo: 'no-aplica' };
  if (c.minimo && base < c.minimo) return { c, monto: 0, motivo: 'minimo', falta: c.minimo - base };
  const monto = c.tipo === 'monto' ? Math.min(c.valor, base) : Math.round((base * c.valor) / 100);
  return { c, monto, base };
}
const conDescuento = () => bagTotal() - ((descuento() || {}).monto || 0);

async function aplicarCupon(codigo, silencioso) {
  const code = normCodigo(codigo);
  if (!code) return;
  let c = null;
  try {
    const h = await huella(code);
    c = CUPONES.find((x) => x.h === h && !(x.vence && x.vence < hoyChile())) || null;
  } catch (e) {
    console.error(e); // crypto.subtle solo existe en https o localhost
  }
  CUPON = c ? { codigo: code, c } : null;
  try { c ? localStorage.setItem(CUPON_KEY, code) : localStorage.removeItem(CUPON_KEY); } catch (e) {}
  if (!c && !silencioso) {
    const st = $('#cuponStatus');
    st.hidden = false;
    st.className = 'coupon__status is-bad';
    st.innerHTML = '<strong>Código no válido</strong><small>No existe o ya no está vigente. Revisa que esté bien escrito.</small>';
    return;
  }
  if (c && !silencioso) $('#fCupon').value = '';
  renderBag();
}

function quitarCupon() {
  CUPON = null;
  try { localStorage.removeItem(CUPON_KEY); } catch (e) {}
  $('#cuponStatus').hidden = true;
  renderBag();
}

function renderCupon() {
  const st = $('#cuponStatus');
  const d = descuento();
  $('#cuponForm').hidden = !!CUPON;
  if (!d) { if (!st.classList.contains('is-bad')) st.hidden = true; return; }
  const c = d.c;
  const detalle = [cuponTexto(c), c.aplica !== 'Toda la carta' ? `en ${c.aplica}` : 'en toda la carta', c.minimo ? `pedido mínimo ${clp(c.minimo)}` : '', c.vence ? `válido hasta el ${fechaCL(c.vence)}` : '']
    .filter(Boolean).join(' · ');
  const aviso = d.motivo === 'no-aplica'
    ? '<em>Este código no aplica a lo que tienes en la comanda.</em>'
    : d.motivo === 'minimo' ? `<em>Te faltan ${clp(d.falta)} para usarlo.</em>` : '';
  st.hidden = false;
  st.className = `coupon__status ${d.monto ? 'is-ok' : 'is-warn'}`;
  st.innerHTML = `
    <span class="coupon__badge"><svg class="ic"><use href="#i-check"/></svg>Código válido</span>
    <strong>${esc(CUPON.codigo)} · ${esc(c.titulo)}</strong>
    <small>${esc(detalle)}</small>
    ${aviso}
    <button type="button" class="coupon__rm" data-quitar-cupon>Quitar código</button>`;
}

function renderBag(bump) {
  const lines = bagLines();
  const units = lines.reduce((s, l) => s + l.qty, 0);
  const n = $('#bagCount');
  n.hidden = !units;
  n.textContent = units;
  if (bump && !reduceMotion) { n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump'); }
  const fab = $('.fab');
  fab.hidden = !units;
  $('#fabLabel').textContent = `Ver mi comanda (${units}) · ${clp(conDescuento())}`;

  $('#bagList').innerHTML = lines.map((l, i) => `
    <li class="bag-item${`${l.id}|${l.variant}` === lastAdded ? ' is-new' : ''}">
      <img src="${esc(l.p.thumb)}" alt="">
      <div class="bag-item__main">
        <h4>${esc(l.p.name)}${l.p.pcs ? ` · ${esc(l.p.pcs)}` : ''}</h4>
        <small>${l.variant ? `${esc(l.variant)}${l.sinOpcion ? ' <em>(ya no disponible)</em>' : ''} · ` : ''}${clp(l.precio)} c/u</small>
        ${CUPON && l.precio && aplicaA(CUPON.c, l.id) ? `<span class="tag-off">Código ${esc(CUPON.codigo)}</span>` : ''}
        <div class="qty">
          <button type="button" data-line="${i}" data-step="-1" aria-label="Menos">−</button>
          <span>${l.qty}</span>
          <button type="button" data-line="${i}" data-step="1" aria-label="Más">+</button>
        </div>
      </div>
      <div class="bag-item__side">
        <strong>${clp(l.precio * l.qty)}</strong>
        <button type="button" class="bag-item__rm" data-remove="${i}" aria-label="Quitar ${esc(l.p.name)}"><svg class="ic"><use href="#i-trash"/></svg></button>
      </div>
    </li>`).join('');
  lastAdded = null;
  $('#bagEmpty').hidden = !!lines.length;
  $('#extrasBox').hidden = !lines.length;
  $('#couponBox').hidden = !lines.length || !CUPONES.length;
  renderCupon();
  $('#bagTitle').textContent = lines.length ? `Tu comanda (${units})` : 'Tu comanda';
  updateOrder();
}

$('#bagList').addEventListener('click', (e) => {
  const lines = bagLines();
  const step = e.target.closest('[data-step]');
  const rm = e.target.closest('[data-remove]');
  const line = step ? lines[step.dataset.line] : rm ? lines[rm.dataset.remove] : null;
  if (!line) return;
  const idx = BAG.findIndex((l) => l.id === line.id && l.variant === line.variant);
  if (rm || BAG[idx].qty + Number(step.dataset.step) < 1) BAG.splice(idx, 1);
  else BAG[idx].qty = Math.min(MAX_QTY, BAG[idx].qty + Number(step.dataset.step));
  saveBag();
  renderBag();
});

function openBag(encargo) {
  closeProduct();
  renderBag();
  if (encargo) $('#encargoBox').open = true;
  bagEl.classList.add('is-open');
  bagEl.setAttribute('aria-hidden', 'false');
  lockScroll();
  (encargo ? $('#fEncargo') : bagEl.querySelector('.modal__close')).focus();
}
function closeBag() {
  if (!bagEl.classList.contains('is-open')) return;
  bagEl.classList.remove('is-open');
  bagEl.setAttribute('aria-hidden', 'true');
  lockScroll();
}

// Una pieza de sushi vuela desde el botón hasta la comanda
function flyFrom(el) {
  if (reduceMotion || !el || !el.getBoundingClientRect) return;
  const target = $('.fab:not([hidden])') || $('.bag-btn');
  const a = el.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const dot = document.createElement('span');
  dot.className = 'fly';
  document.body.appendChild(dot);
  const x0 = a.left + a.width / 2 - 17;
  const y0 = a.top + a.height / 2 - 17;
  const x1 = b.left + b.width / 2 - 17;
  const y1 = b.top + b.height / 2 - 17;
  const anim = dot.animate([
    { transform: `translate(${x0}px, ${y0}px) scale(1) rotate(0deg)` },
    { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - 120}px) scale(1.2) rotate(180deg)`, offset: 0.45 },
    { transform: `translate(${x1}px, ${y1}px) scale(.4) rotate(360deg)`, opacity: 0.3 },
  ], { duration: 750, easing: 'cubic-bezier(.4,.1,.3,1)' });
  anim.onfinish = () => dot.remove();
}

// ===== PEDIDO =====
const form = $('#orderForm');
const radio = (name) => (form.querySelector(`input[name="${name}"]:checked`) || {}).value || '';
let PALILLOS = 2;

// Salsas extra (las define el local en /admin → Ajustes)
$('#fSalsas').innerHTML = (TIENDA.salsas || [])
  .map((s) => `<label><input type="checkbox" name="salsa" value="${esc(s)}"><span>${esc(s)}</span></label>`).join('');
if (!(TIENDA.salsas || []).length) $('#fSalsas').hidden = true;

// Medios de pago: la tarjeta solo se puede usar al retirar en el local
const pagosActivos = [
  TIENDA.pagos.efectivo && 'efectivo',
  TIENDA.pagos.transferencia && 'transferencia',
  TIENDA.pagos.tarjeta_retiro && 'tarjeta',
].filter(Boolean);
$('#fPago').innerHTML = pagosActivos
  .map((k, i) => `<label><input type="radio" name="pago" value="${k}"${i ? '' : ' checked'}><span>${PAGOS[k].label}</span></label>`).join('');
$('#fPago').style.setProperty('--n', pagosActivos.length);
if (!TIENDA.propina) $('#propinaBox').hidden = true;

function fillComunas() {
  $('#fComuna').innerHTML = '<option value="">Elige tu comuna</option>' +
    ZONAS.map((z) => `<option value="${esc(z.comuna)}">${esc(z.comuna)}${z.costo ? ` · ${clp(z.costo)}` : ''}</option>`).join('') +
    (OTRA_COMUNA ? '<option value="otra">Otra comuna (consultar)</option>' : '');
}

// Horas de retiro: cada 15 minutos desde ahora (+25 min de preparación) hasta el cierre
function fillHoras() {
  const sel = $('#fHora');
  const prev = sel.value;
  const e = estado();
  const prep = 25;
  const opts = [];
  if (e.abierto) opts.push(['asap', `Lo antes posible (~${prep} min)`]);
  let start = e.abierto ? Math.ceil((e.min + prep) / 15) * 15 : e.antes ? e.abre + 15 : null;
  if (start !== null) {
    for (let m = start; m <= e.cierra - 15; m += 15) opts.push([`${pad(Math.floor(m / 60))}:${pad(m % 60)}`, `Hoy a las ${pad(Math.floor(m / 60))}:${pad(m % 60)}`]);
  }
  if (!opts.length) opts.push(['manana', `Mañana desde las ${TIENDA.hora_abre}`]);
  sel.innerHTML = opts.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
  if (opts.some(([v]) => v === prev)) sel.value = prev;
}

function readOrder() {
  const delivery = radio('entrega') === 'delivery';
  const horaSel = $('#fHora').selectedOptions[0];
  return {
    delivery,
    nombre: $('#fNombre').value.trim(),
    comuna: $('#fComuna').value,
    direccion: $('#fDireccion').value.trim(),
    ref: $('#fRef').value.trim(),
    hora: horaSel ? horaSel.textContent : '',
    pago: radio('pago'),
    propina: Number(radio('propina')) || 0,
    nota: $('#fNota').value.trim(),
    encargo: $('#fEncargo').value.trim(),
    salsas: [...form.querySelectorAll('input[name="salsa"]:checked')].map((i) => i.value),
    palillos: PALILLOS,
  };
}

const zonaDe = (comuna) => ZONAS.find((z) => z.comuna === comuna);
function totales(o) {
  const subtotal = bagTotal();
  const d = descuento();
  const off = (d && d.monto) || 0;
  const propina = o.propina ? Math.round(((subtotal - off) * o.propina) / 100) : 0;
  const z = o.delivery ? zonaDe(o.comuna) : null;
  const delivery = z && z.costo ? z.costo : 0;
  return { subtotal, d, off, propina, delivery, total: subtotal - off + propina + delivery, deliveryPendiente: o.delivery && !delivery };
}

// Código corto para identificar la comanda en el chat (ej: GS-4K7Q)
const orderCode = () => 'GS-' + Date.now().toString(36).slice(-4).toUpperCase();
let CODE = orderCode();

// *texto* = negrita y _texto_ = cursiva en WhatsApp
function buildMessage(o) {
  const lines = bagLines();
  const t = totales(o);
  const L = [`🍣 *COMANDA ${TIENDA.nombre.toUpperCase()} · ${CODE}* 🥢`, '━━━━━━━━━━━━━━━'];
  if (lines.length) {
    L.push('🧾 *Pedido*');
    lines.forEach((l, i) => {
      const off = t.off && aplicaA(t.d.c, l.id) ? ' 🏷️' : '';
      L.push(`${i + 1}. *${l.p.name}*${l.p.pcs ? ` (${l.p.pcs})` : ''} x${l.qty} — ${clp(l.precio * l.qty)}${off}`);
      if (l.variant) L.push(`    ↳ ${l.p.vars ? l.p.vars.titulo : 'Opción'}: ${l.variant}`);
    });
  }
  if (o.encargo) L.push(`✍️ *Pedido libre:* _${o.encargo}_`);
  if (lines.length) {
    L.push(`🥢 *Palillos:* ${o.palillos || 'sin palillos'}`);
    if (o.salsas.length) L.push(`🥫 *Salsas extra:* ${o.salsas.join(', ')} _(a confirmar)_`);
  }
  L.push('━━━━━━━━━━━━━━━');
  L.push(`🙋 *Nombre:* ${o.nombre || '_(por completar)_'}`);
  if (o.delivery) {
    const comuna = o.comuna === 'otra' ? 'Otra comuna (consultar cobertura)' : o.comuna;
    L.push(`🛵 *Delivery:* ${comuna || '_(por completar)_'}`);
    L.push(`🏠 *Dirección:* ${o.direccion || '_(por completar)_'}${o.ref ? ` · ${o.ref}` : ''}`);
  } else {
    L.push(`🏮 *Retiro en local:* ${TIENDA.direccion}${TIENDA.barrio ? `, ${TIENDA.barrio}` : ''}`);
    L.push(`⏰ *Hora:* ${o.hora || '_(por definir)_'}`);
  }
  L.push((PAGOS[o.pago] || PAGOS.efectivo).msg);
  if (o.nota) L.push(`💬 *Nota para la cocina:* _${o.nota}_`);
  L.push('━━━━━━━━━━━━━━━');
  if (lines.length) {
    if (t.off || t.propina || o.delivery) L.push(`🧾 Subtotal: ${clp(t.subtotal)}`);
    if (t.off) L.push(`🎟️ Código ${CUPON.codigo} _(${t.d.c.titulo})_: −${clp(t.off)}`);
    if (t.propina) L.push(`🙏 Propina ${o.propina}%: ${clp(t.propina)}`);
    if (o.delivery) L.push(`🛵 Delivery: ${t.delivery ? clp(t.delivery) : '_a confirmar_'}`);
    L.push(`💰 *TOTAL: ${clp(t.total)}*${t.deliveryPendiente ? ' _+ delivery_' : ''}`);
    L.push('');
    L.push('¡Hola Gorbea! Quiero hacer este pedido 🙌');
  } else {
    L.push('¡Hola Gorbea! Quiero cotizar este pedido 🙌');
  }
  return L.join('\n');
}

// Vista previa con el formato de WhatsApp
const formatPreview = (text) => esc(text)
  .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
  .replace(/(^|\s|\(|—\s)_([^_\n]+)_/g, '$1<em>$2</em>');

function updateOrder() {
  const o = readOrder();
  const lines = bagLines();
  document.querySelectorAll('[data-delivery]').forEach((el) => { el.hidden = !o.delivery; });
  document.querySelectorAll('[data-retiro]').forEach((el) => { el.hidden = o.delivery; });
  // la tarjeta solo se recibe en el local
  const tarjeta = form.querySelector('input[name="pago"][value="tarjeta"]');
  if (tarjeta) {
    tarjeta.disabled = o.delivery;
    if (o.delivery && tarjeta.checked) form.querySelector('input[name="pago"]:not([value="tarjeta"])').checked = true;
  }
  $('#pagoHint').textContent = tarjeta ? (o.delivery ? 'Con delivery pagas en efectivo o transferencia. Tarjeta solo en el local.' : 'En el local recibimos tarjeta de débito y crédito.') : '';

  const t = totales(readOrder());
  $('#bagTotal').textContent = lines.length ? clp(t.total) : '—';
  const rows = [];
  if (lines.length && (t.off || t.propina || o.delivery)) rows.push(['Subtotal', clp(t.subtotal)]);
  if (t.off) rows.push([`Código ${esc(CUPON.codigo)}`, `−${clp(t.off)}`, 'off']);
  if (t.propina) rows.push([`Propina ${o.propina}%`, clp(t.propina)]);
  if (lines.length && o.delivery) rows.push(['Delivery', t.delivery ? clp(t.delivery) : 'a confirmar']);
  $('#bagSums').innerHTML = rows.map(([a, b, c]) => `<span>${a}</span><span${c ? ` class="${c}"` : ''}>${b}</span>`).join('');
  $('#bagTotalLabel').textContent = t.deliveryPendiente && lines.length ? 'Total sin delivery' : 'Total';
  const e = estado();
  $('#bagHint').textContent = !e.abierto
    ? `Ahora estamos cerrados: tu comanda queda para cuando abramos (${TIENDA.hora_abre}).`
    : o.delivery
      ? 'El costo del delivery y el tiempo de entrega te los confirmamos por WhatsApp.'
      : 'Te avisamos por WhatsApp cuando tu pedido esté listo para retirar.';
  $('#msgPreview').innerHTML = formatPreview(buildMessage(readOrder()));
  $('#bagCode').textContent = `Comanda Nº ${CODE}`;
}

form.addEventListener('input', updateOrder);
form.addEventListener('change', (e) => {
  if (e.target.name === 'entrega') fillHoras();
  updateOrder();
});
$('#fEncargo').addEventListener('input', updateOrder);
$('#extrasBox').addEventListener('click', (e) => {
  const b = e.target.closest('[data-palillos]');
  if (!b) return;
  PALILLOS = Math.min(20, Math.max(0, PALILLOS + Number(b.dataset.palillos)));
  $('#fPalillos').textContent = PALILLOS;
  updateOrder();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const o = readOrder();
  const missing = [];
  if (!bagLines().length && !o.encargo) missing.push('agrega algo a la comanda o escribe un pedido libre');
  if (!o.nombre) missing.push('tu nombre');
  if (o.delivery) {
    if (!o.comuna) missing.push('la comuna');
    if (!o.direccion) missing.push('la dirección');
  }
  const err = $('#formError');
  if (missing.length) {
    err.textContent = 'Falta: ' + missing.join(', ') + '.';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  window.open(waUrl(buildMessage(o)), '_blank', 'noopener');
  CODE = orderCode(); // la próxima comanda lleva otro número
  updateOrder();
});

$('#cuponBtn').addEventListener('click', () => aplicarCupon($('#fCupon').value));
$('#fCupon').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); aplicarCupon($('#fCupon').value); } });
$('#fCupon').addEventListener('input', () => { const st = $('#cuponStatus'); if (st.classList.contains('is-bad')) st.hidden = true; });
$('#couponBox').addEventListener('click', (e) => { if (e.target.closest('[data-quitar-cupon]')) quitarCupon(); });

// ===== EVENTOS GENERALES =====
document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) { quickAdd(add.dataset.add, add); if (!add.hasAttribute('data-promo-close')) return; }
  const view = e.target.closest('[data-view]');
  if (view) { openProduct(view.dataset.view); return; }
  if (e.target.closest('[data-encargo]')) { openBag(true); return; }
  if (e.target.closest('[data-open-bag]')) { openBag(); return; }
  if (e.target.closest('[data-close-bag]')) {
    closeBag();
    if (e.target.closest('[data-go-carta]')) $('#carta').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  }
});
document.addEventListener('keydown', (e) => {
  if (pModal.classList.contains('is-open') && current && current.gallery.length > 1) {
    if (e.key === 'ArrowLeft') showPhoto(photo - 1);
    if (e.key === 'ArrowRight') showPhoto(photo + 1);
  }
  if (e.key !== 'Escape') return;
  if (pModal.classList.contains('is-open')) closeProduct();
  else closeBag();
});

// ===== PROMO EN VENTANA EMERGENTE (una vez por visita) =====
const promo = $('#promoModal');
if (promo) {
  const key = 'promo-vista:' + promo.dataset.flyer; // una promo nueva se vuelve a mostrar
  const seen = () => { try { return sessionStorage.getItem(key); } catch { return null; } };
  const closePromo = () => {
    promo.classList.remove('is-open');
    promo.setAttribute('aria-hidden', 'true');
    lockScroll();
  };
  promo.addEventListener('click', (e) => { if (e.target.closest('[data-promo-close]')) closePromo(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && promo.classList.contains('is-open')) closePromo(); });
  if (!seen()) {
    setTimeout(() => {
      if (pModal.classList.contains('is-open') || bagEl.classList.contains('is-open')) return; // no interrumpir un pedido en curso
      try { sessionStorage.setItem(key, '1'); } catch {}
      promo.classList.add('is-open');
      promo.setAttribute('aria-hidden', 'false');
      lockScroll();
      promo.querySelector('.modal__close').focus();
    }, 2500);
  }
}

// ===== EFECTOS: encabezado de vidrio, apariciones, parallax de los platos y mapa diferido =====
const topBar = $('#top');
let ticking = false;
const parallax = [...document.querySelectorAll('[data-parallax]')];
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
function onScroll() {
  ticking = false;
  const y = window.scrollY;
  topBar.classList.toggle('is-glass', y > 24);
  if (!reduceMotion && finePointer && y < window.innerHeight) {
    parallax.forEach((el) => { el.style.translate = `0 ${(y * Number(el.dataset.parallax)).toFixed(1)}px`; });
  }
}
window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
onScroll();

const reveals = document.querySelectorAll('[data-reveal]');
if (reduceMotion || !('IntersectionObserver' in window)) reveals.forEach((el) => el.classList.add('is-in'));
else {
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
  }), { threshold: 0.15 });
  reveals.forEach((el) => io.observe(el));
}

// Letrero de neón: parpadea una vez al aparecer
const neon = $('[data-status-neon]');
if (neon && 'IntersectionObserver' in window && !reduceMotion) {
  const nio = new IntersectionObserver(([en]) => { if (en.isIntersecting) { neon.classList.add('is-on'); nio.disconnect(); } }, { threshold: 0.6 });
  nio.observe(neon);
}

// Contador de la cifra de la portada (el HTML ya trae el número final)
document.querySelectorAll('[data-count]').forEach((el) => {
  const end = Number(el.dataset.count);
  if (reduceMotion || !end) return;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 1100);
    el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});

// El mapa de Google se carga solo cuando el cliente llega a esa sección
const map = $('[data-map]');
if (map && 'IntersectionObserver' in window) {
  const mio = new IntersectionObserver(([en]) => {
    if (!en.isIntersecting) return;
    mio.disconnect();
    const f = document.createElement('iframe');
    f.src = map.dataset.map;
    f.title = `Mapa: ${TIENDA.direccion}`;
    f.loading = 'lazy';
    f.referrerPolicy = 'no-referrer-when-downgrade';
    map.appendChild(f);
  }, { rootMargin: '300px 0px' });
  mio.observe(map);
}

// Videos del local: se descargan al acercarse y solo se reproducen en pantalla
const shotVideos = document.querySelectorAll('.shot video');
const loadVideo = (v) => { if (v.dataset.src) { v.src = v.dataset.src; delete v.dataset.src; } };
if (shotVideos.length && 'IntersectionObserver' in window) {
  const vio = new IntersectionObserver((entries) => entries.forEach(({ target, isIntersecting }) => {
    if (isIntersecting) { loadVideo(target); target.play().catch(() => {}); } else target.pause();
  }), { threshold: 0.25, rootMargin: '200px 0px' });
  shotVideos.forEach((v) => vio.observe(v));
}

// ===== CARGA DEL CATÁLOGO =====
async function loadProducts() {
  try {
    const res = await fetch('data/catalogo.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const categorias = Array.isArray(data.categorias) ? data.categorias : [];

    // producto -> categorías a las que pertenece (la categoría es la que dice qué productos tiene)
    const tagsOf = {};
    categorias.forEach((c) => (c.productos || []).forEach((id) => (tagsOf[id] = tagsOf[id] || []).push(c.id)));
    const nombreCat = Object.fromEntries(categorias.map((c) => [c.id, c.nombre]));

    const path = (s) => String(s).replace(/^\//, '');
    FILTERS = [['todos', 'Todo'], ...categorias.map((c) => [c.id, c.nombre])];
    CUPONES = Array.isArray(data.cupones) ? data.cupones : [];
    ZONAS = Array.isArray(data.zonas) ? data.zonas : [];
    OTRA_COMUNA = data.otra_comuna !== false;
    PRODUCTS = (data.productos || []).map((p, i) => {
      const img = path(p.foto || 'img/logo.jpg');
      const fotos = Array.isArray(p.fotos) ? p.fotos.map(path) : [];
      // versiones livianas que genera el build (si faltan, se usan las originales)
      const minis = Array.isArray(p.minis) && p.minis.length === fotos.length ? p.minis.map(path) : fotos;
      const thumb = p.mini ? path(p.mini) : img;
      const tags = tagsOf[p.id] || [];
      return {
        id: p.id,
        no: i + 1,
        name: p.nombre,
        pcs: p.piezas || '',
        price: Number(p.precio) || 0,
        desde: !!p.desde,
        img,
        gallery: [img, ...fotos],
        thumb,
        thumbs: [thumb, ...minis],
        desc: p.descripcion || '',
        list: Array.isArray(p.incluye) ? p.incluye : [],
        vars: p.variantes && Array.isArray(p.variantes.opciones) && p.variantes.opciones.length ? p.variantes : null,
        tags,
        cat: nombreCat[tags[0]] || '',
        badge: p.etiqueta || '',
        agotado: !!p.agotado,
      };
    });
  } catch (e) {
    console.error(e);
    observeTickets();
    return; // conserva el HTML que ya escribió el build
  }
  fillComunas();
  if (!PRODUCTS.some((p) => p.price > 0)) document.querySelector('.sort').hidden = true;
  renderFilters(currentCat);
  renderProducts(currentCat);
  renderBag();
  // vuelve a validar el código que quedó guardado (pudo vencer o apagarse en /admin)
  let guardado = '';
  try { guardado = localStorage.getItem(CUPON_KEY) || ''; } catch (e) {}
  if (guardado && CUPONES.length) aplicarCupon(guardado, true);
}

markFeature();
observeTickets();
fillHoras();
setInterval(fillHoras, 5 * 60000);
updateOrder();
loadProducts();
