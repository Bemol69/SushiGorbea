// Arma la web para publicar. Vercel lo ejecuta en cada cambio (ver vercel.json).
//  1. Lee tienda.config.json (lo define el desarrollador) y data/*.json (lo edita el cliente en /admin)
//  2. Junta data/productos/*.json, data/categorias/*.json y data/cupones/*.json en data/catalogo.json
//  3. Copia el sitio a dist/ reemplazando los %%MARCADORES%%, escribe las comandas dentro del HTML
//     (para Google) y genera canonical, Open Graph, datos estructurados, robots.txt y sitemap.xml
// Uso local: node scripts/build.mjs  →  servir la carpeta dist/
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(ROOT, 'data');
const DIST = join(ROOT, 'dist');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, 'data'), { recursive: true });

// ---------- Fotos livianas ----------
// Las comandas, la portada, el flyer y el local muestran las fotos en tamaño chico:
// se genera una copia WebP del ancho justo en dist/img/_opt/. El nombre lleva un hash del
// contenido, así el navegador la guarda en caché y una foto reemplazada en /admin se ve al tiro.
// Las originales se mantienen (ficha del producto, Google, redes sociales).
// Si sharp no está instalado, se usan las originales.
let sharp = null;
try { sharp = (await import('sharp')).default; } catch { console.warn('⚠️  sharp no está instalado (npm install): se usan las fotos originales'); }
const OPT = 'img/_opt';
const optimizadas = new Map();
function optimizar(src, ancho) {
  const path = String(src || '').replace(/^\//, '');
  if (!sharp || !/\.(jpe?g|png|webp)$/i.test(path) || !existsSync(join(ROOT, path))) return Promise.resolve(path);
  const key = `${path}@${ancho}`;
  if (!optimizadas.has(key)) {
    optimizadas.set(key, (async () => {
      try {
        const buf = readFileSync(join(ROOT, path));
        const out = `${OPT}/${createHash('sha1').update(buf).digest('hex').slice(0, 12)}-${ancho}.webp`;
        mkdirSync(join(DIST, OPT), { recursive: true });
        await sharp(buf).rotate().resize({ width: ancho, withoutEnlargement: true }).webp({ quality: 76 }).toFile(join(DIST, out));
        return out;
      } catch (e) {
        console.warn(`⚠️  No se pudo optimizar ${path}: ${e.message}`);
        return path;
      }
    })());
  }
  return optimizadas.get(key);
}
const MINI = 640; // ancho de las fotos en las comandas (≈320 px en pantalla, x2 para pantallas retina)
const config = readJson(join(ROOT, 'tienda.config.json'));
const readData = (file) => {
  if (!existsSync(join(DATA, file))) return {};
  try { return readJson(join(DATA, file)); } catch (e) { console.warn(`⚠️  ${file} está dañado: se usan valores por defecto (${e.message})`); return {}; }
};
const ajustes = readData('ajustes.json');
const flyer = readData('flyer.json');       // promo destacada (editable en /admin)
const zonasData = readData('zonas.json');   // comunas con delivery (editable en /admin)
const franjasData = readData('franjas.json');
const localData = readData('local.json');   // 3 fotos de «Desde la barra» (editable en /admin)

// Manda el dominio propio de site_url; si todavía es un .vercel.app, se usa el dominio de producción de Vercel
const propio = config.site_url && !/\.vercel\.app/.test(config.site_url);
const SITE = (!propio && process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : config.site_url || 'http://localhost:5600').replace(/\/$/, '');

// ---------- 1. Datos de la tienda ----------
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const hora = (v, def) => (/^\d{2}:\d{2}$/.test(str(v)) ? str(v) : def);
const pagos = ajustes.metodos_pago || {};
const T = {
  nombre: str(config.nombre),
  rubro: str(config.rubro),
  schema_tipo: str(config.schema_tipo) || 'Restaurant',
  whatsapp: str(ajustes.whatsapp).replace(/\D/g, ''),
  instagram: str(ajustes.instagram).replace(/^@/, ''),
  facebook: str(ajustes.facebook),
  direccion: str(ajustes.direccion),
  barrio: str(ajustes.barrio),
  ciudad: str(ajustes.ciudad),
  region: str(ajustes.region),
  seguidores: str(ajustes.seguidores),
  horario_dias: str(ajustes.horario_dias) || 'Lunes a domingo',
  hora_abre: hora(ajustes.hora_abre, '12:00'),
  hora_cierra: hora(ajustes.hora_cierra, '23:00'),
  hora_cierra_finde: hora(ajustes.hora_cierra_finde, hora(ajustes.hora_cierra, '23:00')),
  hero_titulo: str(ajustes.hero_titulo),
  hero_destacado: str(ajustes.hero_destacado),
  hero_bajada: str(ajustes.hero_bajada),
  salsas: (Array.isArray(ajustes.salsas) ? ajustes.salsas : []).map(str).filter(Boolean),
  pagos: {
    efectivo: pagos.efectivo !== false,
    transferencia: pagos.transferencia !== false,
    tarjeta_retiro: pagos.tarjeta_retiro !== false,
  },
  propina: ajustes.propina !== false,
};
if (!Object.values(T.pagos).some(Boolean)) T.pagos.transferencia = true;

const zonas = (Array.isArray(zonasData.zonas) ? zonasData.zonas : [])
  .map((z) => ({ comuna: str(z && z.comuna), costo: Math.max(0, Math.round(Number(z && z.costo) || 0)) }))
  .filter((z) => z.comuna);

// ---------- Promo destacada (flyer) ----------
const rel = (path) => str(path).replace(/^\//, '');
const F = {
  imagen: flyer.mostrar !== false ? rel(flyer.imagen) : '',
  titulo: str(flyer.titulo) || 'Promo de la semana',
  descripcion: str(flyer.descripcion),
  mensaje: str(flyer.mensaje_whatsapp) || '¡Hola Gorbea! Quiero la promo 🍣',
  producto: str(flyer.producto),
};
F.popup = F.imagen && flyer.popup !== false ? F.imagen : '';

// ---------- Fotos del local (siempre 3) ----------
const LOCAL_BASE = [
  { archivo: 'img/local/barra.jpg', titulo: 'La barra', texto: 'Gorbea 2081', descripcion: 'El local de Gorbea Sushi' },
  { archivo: 'img/local/sushipleto.jpg', titulo: 'Sushipleto', texto: 'El completo, versión sushi', descripcion: 'Sushi completo' },
  { archivo: 'img/local/gohan.jpg', titulo: 'Gohan especial', texto: 'Para comer en el local', descripcion: 'Gohan especial' },
];
const listaLocal = Array.isArray(localData.fotos) ? localData.fotos : [];
const local = LOCAL_BASE.map((base, i) => {
  const e = listaLocal[i] || {};
  const archivo = rel(e.archivo) || base.archivo;
  return {
    archivo,
    video: /\.(mp4|webm|m4v|mov)$/i.test(archivo),
    titulo: str(e.titulo) || (e.archivo ? '' : base.titulo),
    texto: str(e.texto) || (e.archivo ? '' : base.texto),
    descripcion: str(e.descripcion) || str(e.titulo) || base.descripcion,
  };
});

// ---------- Franja de texto en movimiento ----------
const FRANJA_BASE = ['Fusión & tradición', 'Rolls calientes', 'Acevichados', 'Opciones veganas', 'Delivery y retiro'];
const VELOCIDAD = { lenta: 1.6, normal: 1, rapida: 0.6 };
const f1 = franjasData.franja1 || {};
const frases = (Array.isArray(f1.frases) ? f1.frases : []).map(str).filter(Boolean);
const vuelta = [];
while (vuelta.length < 12) vuelta.push(...(frases.length ? frases : FRANJA_BASE));
const FRANJA = { items: vuelta, segundos: Math.round(vuelta.length * 4.5 * (VELOCIDAD[f1.velocidad] || 1)) };

const faltan = ['nombre', 'whatsapp', 'ciudad'].filter((k) => !T[k]);
if (faltan.length) throw new Error(`Faltan datos obligatorios: ${faltan.join(', ')} (tienda.config.json / data/ajustes.json)`);
if (!/^\d{10,15}$/.test(T.whatsapp) || (T.whatsapp.startsWith('56') && !/^569\d{8}$/.test(T.whatsapp))) {
  throw new Error(`WhatsApp inválido "${T.whatsapp}": usa formato internacional; en Chile son 11 dígitos, ej 56912345678`);
}

// ---------- 2. Catálogo ----------
function readFolder(folder) {
  const dir = join(DATA, folder);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const items = [];
  for (const file of files) {
    try {
      items.push({ id: basename(file, '.json'), ...readJson(join(dir, file)) });
    } catch (e) {
      // Un archivo dañado no debe botar todo el catálogo: se omite y se avisa en el log
      console.warn(`⚠️  Se omitió ${folder}/${file}: ${e.message}`);
    }
  }
  return items;
}

const num = (v, def) => (v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : def);
const byOrder = (a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es');

// Variantes (relleno, caliente o frío…): el cliente debe elegir una. Cada opción puede tener su propio precio.
function variantes(v, precioBase) {
  if (!v || typeof v !== 'object') return null;
  const opciones = (Array.isArray(v.opciones) ? v.opciones : [])
    .map((o) => (typeof o === 'string' ? { nombre: o } : o || {}))
    .map((o) => ({ nombre: str(o.nombre), precio: Math.max(0, Math.round(num(o.precio, precioBase))) }))
    .filter((o, i, all) => o.nombre && all.findIndex((x) => x.nombre === o.nombre) === i);
  if (!opciones.length) return null;
  return { titulo: str(v.titulo) || 'Elige una opción', opciones };
}

const productos = readFolder('productos')
  .filter((p) => p.visible !== false && typeof p.nombre === 'string' && p.nombre.trim())
  .map((p) => {
    const precio = Math.max(0, Math.round(num(p.precio, 0)));
    const v = variantes(p.variantes, precio);
    const precios = v ? v.opciones.map((o) => o.precio).filter((n) => n > 0) : [];
    return {
      id: p.id,
      nombre: p.nombre.trim(),
      piezas: str(p.piezas),
      // con variantes, el precio de la tarjeta es el más bajo ("desde")
      precio: precios.length ? Math.min(...precios) : precio,
      desde: precios.length > 1 && Math.min(...precios) !== Math.max(...precios),
      foto: typeof p.foto === 'string' && p.foto ? p.foto.replace(/^\//, '') : 'img/logo.jpg',
      // demo: máximo 1 foto extra por producto
      fotos: (Array.isArray(p.fotos) ? p.fotos : []).filter((f) => typeof f === 'string' && f).map((f) => f.replace(/^\//, '')).slice(0, 1),
      descripcion: typeof p.descripcion === 'string' ? p.descripcion.trim() : '',
      incluye: Array.isArray(p.incluye) ? p.incluye.map((i) => String(i).trim()).filter(Boolean) : [],
      variantes: v,
      etiqueta: typeof p.etiqueta === 'string' ? p.etiqueta.trim() : '',
      agotado: p.agotado === true,
      orden: num(p.orden, 1000),
    };
  })
  .sort(byOrder)
  .map(({ orden, ...p }) => p);

// Versiones chicas para las comandas y miniaturas (la ficha del producto usa las originales)
await Promise.all(productos.map(async (p) => {
  p.mini = await optimizar(p.foto, MINI);
  p.minis = await Promise.all(p.fotos.map((f) => optimizar(f, MINI)));
}));

const ids = new Set(productos.map((p) => p.id));

const categorias = readFolder('categorias')
  .filter((c) => c.visible !== false && typeof c.nombre === 'string' && c.nombre.trim())
  .map((c) => ({
    id: c.id,
    nombre: c.nombre.trim(),
    orden: num(c.orden, 1000),
    // se descartan productos borrados u ocultos, y repetidos
    productos: [...new Set(Array.isArray(c.productos) ? c.productos : [])].filter((id) => ids.has(id)),
  }))
  .sort(byOrder)
  .map(({ orden, ...c }) => c);
const catDe = (id) => categorias.filter((c) => c.productos.includes(id)).map((c) => c.id);
const catNombre = (id) => (categorias.find((c) => c.productos.includes(id)) || {}).nombre || '';

// ---------- Códigos de descuento (data/cupones, editables en /admin) ----------
// Se publican como huella SHA-256 y no como texto: la web puede comprobar un código que le escriben,
// pero nadie puede sacar la lista de códigos mirando el archivo. La sal debe coincidir con CUPON_SAL en app.js.
const CUPON_SAL = 'gorbea-sushi:';
const normCodigo = (c) => str(c).toUpperCase().replace(/\s+/g, '');
const huella = (c) => createHash('sha256').update(CUPON_SAL + normCodigo(c)).digest('hex');
const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }); // AAAA-MM-DD
const productosDe = Object.fromEntries(categorias.map((c) => [c.id, c.productos]));
const vistos = new Set();
const cupones = readFolder('cupones')
  .filter((c) => c.activo !== false && normCodigo(c.codigo))
  .map((c) => {
    const tipo = c.tipo === 'monto' ? 'monto' : 'porcentaje';
    const valor = Math.max(0, Math.round(num(c.valor, 0)));
    const vence = /^\d{4}-\d{2}-\d{2}/.test(str(c.vence)) ? str(c.vence).slice(0, 10) : '';
    // sin productos ni categorías elegidos = aplica a toda la carta
    const cats = Array.isArray(c.categorias) ? c.categorias : [];
    const prods = Array.isArray(c.productos) ? c.productos : [];
    const todos = !cats.length && !prods.length;
    return {
      id: c.id,
      codigo: normCodigo(c.codigo),
      h: huella(c.codigo),
      titulo: str(c.titulo) || normCodigo(c.codigo),
      tipo,
      valor: tipo === 'porcentaje' ? Math.min(100, valor) : valor,
      minimo: Math.max(0, Math.round(num(c.minimo, 0))),
      vence,
      productos: todos ? null : [...new Set([...cats.flatMap((id) => productosDe[id] || []), ...prods])].filter((id) => ids.has(id)),
      aplica: todos ? 'Toda la carta' : [...categorias.filter((x) => cats.includes(x.id)).map((x) => x.nombre), ...(prods.length ? ['productos seleccionados'] : [])].join(', '),
    };
  })
  .filter((c) => {
    if (!c.valor) return console.warn(`⚠️  Cupón «${c.titulo}» sin valor de descuento: se omitió`), false;
    if (c.vence && c.vence < hoy) return console.warn(`ℹ️  Cupón «${c.titulo}» vencido el ${c.vence}: se omitió`), false;
    if (c.productos && !c.productos.length) return console.warn(`⚠️  Cupón «${c.titulo}» no tiene productos visibles: se omitió`), false;
    if (vistos.has(c.codigo)) return console.warn(`⚠️  Código ${c.codigo} repetido: se usa solo el primero`), false;
    vistos.add(c.codigo);
    return true;
  })
  .map(({ id, codigo, ...c }) => c);

writeFileSync(join(DATA, 'catalogo.json'), JSON.stringify({
  _aviso: 'Archivo generado por scripts/build.mjs. No editar a mano.',
  categorias,
  productos,
  cupones,
  zonas,
  otra_comuna: zonasData.otra_comuna !== false,
}, null, 2) + '\n');
console.log(`✅ catálogo: ${productos.length} productos, ${categorias.length} categorías, ${cupones.length} códigos de descuento activos, ${zonas.length} comunas con delivery`);
if (productos.length > 15) console.warn(`⚠️  La demo tiene ${productos.length} productos (lo acordado son 15 como máximo)`);

// ---------- 3. Marcadores %%CLAVE%% ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clp = (n) => '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const abs = (path) => `${SITE}/${String(path).replace(/^\//, '')}`;
const colores = config.colores || {};
const fuentes = config.fuentes || {};
const hero = config.hero || {};
const heroFoto = (k, i) => (hero[k] && hero[k].foto) || (productos[i] && productos[i].foto) || 'img/logo.jpg';
const heroAlt = (k, i) => (hero[k] && hero[k].alt) || (productos[i] && productos[i].nombre) || T.nombre;
const HERO_1 = await optimizar(heroFoto('principal', 0), 900);
const HERO_2 = await optimizar(heroFoto('secundaria', 1), 640);
const FLYER_OPT = F.imagen ? await optimizar(F.imagen, 880) : '';
for (const e of local) if (!e.video) e.archivo = await optimizar(e.archivo, 760);
const fuenteParam = (f, pesos) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}${pesos ? `:wght@${pesos}` : ''}`;
const FUENTE_DISPLAY = fuentes.display || 'Dela Gothic One';
const FUENTE_TEXTO = fuentes.texto || 'Zen Kaku Gothic New';
const FUENTE_MONO = fuentes.mono || 'Space Mono';

const SEO_TITULO = str(config.seo_titulo) || `${T.nombre} · ${T.rubro} en ${T.ciudad}`;
const SEO_DESCRIPCION = str(config.seo_descripcion) || T.hero_bajada;
const flyerProducto = productos.find((p) => p.id === F.producto);
const heroProd = productos.find((p) => p.id === str(hero.producto)) || productos[0] || {};
const waLink = (text) => `https://api.whatsapp.com/send?phone=${T.whatsapp}&text=${encodeURIComponent(text)}`;

const VARS = {
  NOMBRE: T.nombre, RUBRO: T.rubro, SEO_TITULO, SEO_DESCRIPCION,
  CIUDAD: T.ciudad, REGION: T.region, DIRECCION: T.direccion, BARRIO: T.barrio,
  INSTAGRAM: T.instagram, FACEBOOK: T.facebook, SEGUIDORES: T.seguidores,
  HORARIO_DIAS: T.horario_dias, HORA_ABRE: T.hora_abre, HORA_CIERRA: T.hora_cierra, HORA_CIERRA_FINDE: T.hora_cierra_finde,
  HORARIO_DISTINTO: T.hora_cierra_finde !== T.hora_cierra ? '1' : '',
  HERO_TITULO: T.hero_titulo, HERO_DESTACADO: T.hero_destacado, HERO_BAJADA: T.hero_bajada,
  HERO_1, HERO_1_ALT: heroAlt('principal', 0), HERO_2, HERO_2_ALT: heroAlt('secundaria', 1),
  N_PRODUCTOS: String(productos.length),
  HERO_PROD_ID: str(heroProd.id), HERO_PROD_NOMBRE: str(heroProd.nombre), HERO_PROD_PIEZAS: str(heroProd.piezas),
  HERO_PROD_PRECIO: heroProd.precio ? clp(heroProd.precio) : '', HERO_PROD_ETIQUETA: str(heroProd.etiqueta),
  HERO_PROD_NO: heroProd.id ? String(productos.indexOf(heroProd) + 1).padStart(2, '0') : '',
  PRECIO_MIN: productos.some((p) => p.precio) ? clp(Math.min(...productos.filter((p) => p.precio).map((p) => p.precio))) : '',
  MAPA_QUERY: encodeURIComponent([T.direccion, T.ciudad, 'Chile'].filter(Boolean).join(', ')),
  FUENTES_URL: `https://fonts.googleapis.com/css2?${fuenteParam(FUENTE_DISPLAY)}&${fuenteParam(FUENTE_TEXTO, '400;500;700')}&${fuenteParam(FUENTE_MONO, '400;700')}&display=swap`,
  FUENTE_DISPLAY, FUENTE_TEXTO, FUENTE_MONO,
  GITHUB_REPO: str(config.github_repo), SITE_URL: `${SITE}/`,
  COLOR_NOCHE: colores.noche, COLOR_NOCHE_2: colores.noche_2, COLOR_MAR: colores.mar, COLOR_MAR_OSCURO: colores.mar_oscuro,
  COLOR_PAPEL: colores.papel, COLOR_TINTA: colores.tinta, COLOR_SALMON: colores.salmon, COLOR_HOT: colores.hot,
  COLOR_ARROZ: colores.arroz, COLOR_NIEBLA: colores.niebla,
  FLYER: FLYER_OPT, FLYER_POPUP: F.popup ? FLYER_OPT : '', FLYER_TITULO: F.titulo, FLYER_TEXTO: F.descripcion,
  FLYER_ALT: F.descripcion || F.titulo, FLYER_PRODUCTO: flyerProducto ? flyerProducto.id : '',
  FLYER_PRECIO: flyerProducto && flyerProducto.precio ? clp(flyerProducto.precio) : '',
  FLYER_WA: waLink(F.mensaje),
  FRANJA_SEG: String(FRANJA.segundos),
  WA_HOLA: waLink('¡Hola Gorbea! Quiero hacer un pedido 🍣'),
  // Solo lo que necesita el navegador (app.js)
  TIENDA_JSON: JSON.stringify({
    nombre: T.nombre, whatsapp: T.whatsapp, direccion: T.direccion, barrio: T.barrio,
    hora_abre: T.hora_abre, hora_cierra: T.hora_cierra, hora_cierra_finde: T.hora_cierra_finde,
    salsas: T.salsas, pagos: T.pagos, propina: T.propina,
  }),
};

// Bloques opcionales: <!-- SI:CLAVE --> ... <!-- /SI:CLAVE --> se eliminan si CLAVE está vacía
function render(text, file, escape) {
  let out = text;
  for (let prev; prev !== out;) { // se repite para resolver bloques anidados
    prev = out;
    out = out.replace(/<!-- SI:([A-Z0-9_]+) -->([\s\S]*?)<!-- \/SI:\1 -->/g, (m, key, body) => (str(VARS[key]) ? body : ''));
  }
  const missing = new Set();
  out = out.replace(/%%([A-Z0-9_]+)%%/g, (m, key) => {
    const v = VARS[key];
    if (v === undefined || v === null || (v === '' && key.startsWith('COLOR_'))) { missing.add(key); return m; }
    return escape && key !== 'TIENDA_JSON' ? esc(v) : String(v);
  });
  if (missing.size) throw new Error(`${file}: faltan valores para ${[...missing].join(', ')}`);
  return out;
}

// ---------- 4. SEO + comandas en el HTML ----------
// Misma comanda que card() en app.js: si cambias una, cambia la otra
const pad = (n) => String(n).padStart(2, '0');
const card = (p, i) => `
    <article class="ticket${p.agotado ? ' is-soldout' : ''}" data-id="${esc(p.id)}" data-cats="${esc(catDe(p.id).join(' '))}" style="--i:${i}">
      <div class="ticket__paper">
        <span class="ticket__clip" aria-hidden="true"></span>
        <header class="ticket__head">
          <span class="ticket__no">Nº ${pad(i + 1)}</span>
          <span class="ticket__cat">${esc(catNombre(p.id))}</span>
        </header>
        <button class="ticket__img" type="button" data-view="${esc(p.id)}" aria-label="Ver ${esc(p.nombre)}">
          ${p.agotado ? '<span class="stamp stamp--out">Agotado</span>' : p.etiqueta ? `<span class="stamp">${esc(p.etiqueta)}</span>` : ''}
          <img src="${esc(p.mini)}" alt="${esc(p.nombre)}" loading="lazy" decoding="async">
          ${p.minis[0] ? `<img class="alt" src="${esc(p.minis[0])}" alt="" loading="lazy" decoding="async">` : ''}
        </button>
        <h3 class="ticket__name">${esc(p.nombre)}${p.piezas ? ` <small>${esc(p.piezas)}</small>` : ''}</h3>
        ${p.incluye.length ? `<ul class="ticket__list">${p.incluye.map((t) => `<li>${esc(t)}</li>`).join('')}${p.incluye.length > 3 ? `<li class="more">+${p.incluye.length - 3} rolls más</li>` : ''}</ul>` : ''}
        ${p.descripcion ? `<p class="ticket__desc">${esc(p.descripcion)}</p>` : ''}
        ${p.variantes ? `<p class="ticket__var">${esc(p.variantes.titulo)}: ${p.variantes.opciones.map((o) => esc(o.nombre.split(' · ')[0])).join(' / ')}</p>` : ''}
        <footer class="ticket__foot">
          <span class="ticket__price${p.precio ? '' : ' is-ask'}">${p.precio ? `${p.desde ? '<small>desde</small> ' : ''}${clp(p.precio)}` : 'Consultar'}</span>
          ${p.agotado
            ? `<a class="btn btn--line btn--sm" target="_blank" rel="noopener" href="${esc(waLink(`¡Hola Gorbea! ¿Hoy tienen ${p.nombre}?`))}">Consultar</a>`
            : `<button class="btn btn--sea btn--sm" type="button" data-${p.variantes ? 'view' : 'add'}="${esc(p.id)}">${p.variantes ? 'Elegir' : 'Agregar'}</button>`}
        </footer>
      </div>
    </article>`;

const localHtml = (e, i) => `
          <figure class="shot shot--${i + 1}">
            ${e.video
              ? `<video data-src="${esc(e.archivo)}#t=0.1" muted loop playsinline preload="none" aria-label="${esc(e.descripcion)}"></video>`
              : `<img src="${esc(e.archivo)}" alt="${esc(e.descripcion)}" loading="lazy" decoding="async">`}
            ${e.titulo || e.texto ? `<figcaption>${e.titulo ? `<strong>${esc(e.titulo)}</strong>` : ''}${e.texto ? `<span>${esc(e.texto)}</span>` : ''}</figcaption>` : ''}
          </figure>`;

const OG_IMAGE = abs(heroFoto('principal', 0));
const precios = productos.map((p) => p.precio).filter((n) => n > 0);
const sameAs = [T.instagram && `https://www.instagram.com/${T.instagram}/`, T.facebook].filter(Boolean);
const DIAS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Sunday'];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': T.schema_tipo,
      '@id': `${SITE}/#local`,
      name: T.nombre,
      description: SEO_DESCRIPCION,
      url: `${SITE}/`,
      logo: abs('img/logo.jpg'),
      image: [OG_IMAGE, abs('img/logo.jpg')],
      telephone: `+${T.whatsapp}`,
      servesCuisine: str(config.cocina) || 'Sushi',
      acceptsReservations: false,
      hasMenu: `${SITE}/#carta`,
      priceRange: precios.length ? `${clp(Math.min(...precios))} – ${clp(Math.max(...precios))}` : undefined,
      currenciesAccepted: 'CLP',
      paymentAccepted: [T.pagos.efectivo && 'Efectivo', T.pagos.transferencia && 'Transferencia', T.pagos.tarjeta_retiro && 'Tarjeta'].filter(Boolean).join(', '),
      address: {
        '@type': 'PostalAddress',
        streetAddress: T.direccion || undefined,
        addressLocality: T.ciudad,
        addressRegion: T.region || undefined,
        addressCountry: 'CL',
      },
      areaServed: zonas.map((z) => ({ '@type': 'City', name: z.comuna })),
      openingHoursSpecification: [
        { '@type': 'OpeningHoursSpecification', dayOfWeek: DIAS, opens: T.hora_abre, closes: T.hora_cierra },
        { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Friday', 'Saturday'], opens: T.hora_abre, closes: T.hora_cierra_finde },
      ],
      sameAs: sameAs.length ? sameAs : undefined,
    },
    {
      '@type': 'ItemList',
      name: 'Carta',
      itemListElement: productos.filter((p) => p.precio > 0).map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Product',
          name: [p.nombre, p.piezas].filter(Boolean).join(' · '),
          image: [p.foto, ...p.fotos].map(abs),
          description: p.descripcion || p.incluye.join('; ') || p.nombre,
          offers: {
            '@type': 'Offer',
            url: `${SITE}/#carta`,
            price: p.precio,
            priceCurrency: 'CLP',
            availability: `https://schema.org/${p.agotado ? 'OutOfStock' : 'InStock'}`,
            seller: { '@id': `${SITE}/#local` },
          },
        },
      })),
    },
  ],
};

const head = `<link rel="canonical" href="${SITE}/">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(T.nombre)}">
  <meta property="og:locale" content="es_CL">
  <meta property="og:url" content="${SITE}/">
  <meta property="og:title" content="${esc(SEO_TITULO)}">
  <meta property="og:description" content="${esc(SEO_DESCRIPCION)}">
  <meta property="og:image" content="${OG_IMAGE}">
  <meta name="twitter:card" content="summary_large_image">${config.google_verificacion
    ? `\n  <meta name="google-site-verification" content="${esc(config.google_verificacion)}">` : ''}
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`;

// ---------- 5. dist/ ----------
let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
for (const marker of ['<!-- SEO:HEAD', '<!-- SEO:PRODUCTOS -->', '<!-- SEO:FILTROS -->', '<!-- LOCAL:FOTOS', '<!-- FRANJA -->']) {
  if (!html.includes(marker)) throw new Error(`Falta el marcador ${marker} en index.html`);
}
const filtros = [['todos', 'Todo', productos.length], ...categorias.filter((c) => c.productos.length).map((c) => [c.id, c.nombre, c.productos.length])]
  .map(([k, label, n], i) => `<button class="tab${i ? '' : ' is-active'}" type="button" role="tab" aria-selected="${!i}" data-cat="${esc(k)}">${esc(label)}<span class="tab__n">${n}</span></button>`)
  .join('');
html = render(html, 'index.html', true)
  .replace(/<!-- SEO:HEAD[^>]*-->/, head)
  .replace('<!-- SEO:PRODUCTOS -->', productos.map(card).join(''))
  .replace('<!-- SEO:FILTROS -->', filtros)
  .replace(/<!-- LOCAL:FOTOS[^>]*-->/, local.map(localHtml).join(''))
  // la franja lleva sus frases 2 veces seguidas: la animación corre la mitad y vuelve a empezar sin salto
  .replaceAll('<!-- FRANJA -->', [...FRANJA.items, ...FRANJA.items].map((t) => `<span>${esc(t)}</span>`).join(''));

cpSync(join(ROOT, 'img'), join(DIST, 'img'), { recursive: true });
if (existsSync(join(ROOT, 'favicon.ico'))) cpSync(join(ROOT, 'favicon.ico'), join(DIST, 'favicon.ico'));
cpSync(join(ROOT, 'admin'), join(DIST, 'admin'), { recursive: true });
cpSync(join(DATA, 'catalogo.json'), join(DIST, 'data', 'catalogo.json'));
// styles.css y app.js llevan ?v=hash: se guardan en caché y cada cambio publicado se descarga de nuevo
const css = render(readFileSync(join(ROOT, 'styles.css'), 'utf8'), 'styles.css', false);
const js = render(readFileSync(join(ROOT, 'app.js'), 'utf8'), 'app.js', false);
const version = (text) => createHash('sha1').update(text).digest('hex').slice(0, 10);
html = html
  .replace('href="styles.css"', `href="styles.css?v=${version(css)}"`)
  .replace('src="app.js"', `src="app.js?v=${version(js)}"`);
writeFileSync(join(DIST, 'index.html'), html);
writeFileSync(join(DIST, 'styles.css'), css);
writeFileSync(join(DIST, 'app.js'), js);
writeFileSync(join(DIST, 'admin', 'config.yml'), render(readFileSync(join(ROOT, 'admin', 'config.yml'), 'utf8'), 'admin/config.yml', false));

writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>
</urlset>
`);

if (!existsSync(join(ROOT, 'img', 'logo.jpg'))) console.warn('⚠️  Falta img/logo.jpg (logo de la tienda)');
console.log(`✅ sitio listo en dist/ para ${SITE}`);
