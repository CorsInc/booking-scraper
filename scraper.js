#!/usr/bin/env node

/**
 * Booking.com Scraper — Puppeteer con evasión anti-bot
 *
 * Uso:
 *   node scraper.js --destination "San Juan"
 *   node scraper.js --destination "San Juan" --checkin 2026-06-01 --checkout 2026-06-05 --adults 2
 *   node scraper.js -d "Isla Verde" -ci 2026-07-15 -co 2026-07-20 -m 10 -o csv
 *
 * Flags:
 *   --destination, -d   Destino (ciudad, hotel, lugar)
 *   --checkin, -ci      Fecha check-in YYYY-MM-DD (opcional)
 *   --checkout, -co     Fecha check-out YYYY-MM-DD (opcional)
 *   --adults, -a        Número de adultos (default: 2)
 *   --max-results, -m   Máximo de resultados (default: 20)
 *   --output, -o        Formato: json (default) o csv
 *   --headless          false para ver el navegador (default: true)
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const args = require('minimist')(process.argv.slice(2));

const DESTINATION = args.destination || args.d || 'San Juan';
const CHECKIN = args.checkin || args.ci || '';
const CHECKOUT = args.checkout || args.co || '';
const ADULTS = args.adults || args.a || 2;
const HEADLESS = args.headless !== 'false';
const MAX_RESULTS = parseInt(args['max-results'] || args.m || 20);
const OUTPUT = args.output || args.o || 'json';

function randomDelay(min = 200, max = 800) {
  return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));
}

(async () => {
  console.log(`🔍 Buscando: "${DESTINATION}" — Check-in: ${CHECKIN || 'sin fecha'} — Check-out: ${CHECKOUT || 'sin fecha'} — Adultos: ${ADULTS}`);

  const browser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080',
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1920, height: 1080 });

  // Evadir detección de automatización
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['es-PR', 'es', 'en'] });
  });

  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-PR,es;q=0.9,en;q=0.8' });

  try {
    // Construir URL con parámetros de búsqueda
    const destEncoded = encodeURIComponent(DESTINATION);
    let url = `https://www.booking.com/searchresults.es.html?ss=${destEncoded}&ssne=${destEncoded}&dest_type=city&adults=${ADULTS}&nflt=ht_id%3D204`;

    if (CHECKIN) url += `&checkin=${CHECKIN}`;
    if (CHECKOUT) url += `&checkout=${CHECKOUT}`;

    console.log(`🌐 Navegando a resultados de búsqueda...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await randomDelay(2000, 4000);

    // Cerrar banner de cookies si aparece
    try {
      const cookieBtn = await page.$(
        'button[aria-label*="cookie" i], button:has-text("Aceptar"), #onetrust-accept-btn-handler, button[data-testid="cookie-banner-accept"]'
      );
      if (cookieBtn) {
        await cookieBtn.click();
        await randomDelay(1000, 2000);
      }
    } catch (_) {}

    // Esperar a que carguen los resultados
    console.log('⏳ Esperando que carguen los resultados...');
    await page.waitForSelector('[data-testid="property-card"]', { timeout: 15000 }).catch(() => {
      console.log('⚠️ Selector property-card no encontrado, intentando extraer de todas formas...');
    });
    await randomDelay(2000, 3000);

    // Extraer datos de los hoteles
    console.log('📥 Extrayendo datos...');
    const results = await page.evaluate((max) => {
      const hotels = [];
      const cards = document.querySelectorAll('[data-testid="property-card"]');

      for (let i = 0; i < Math.min(cards.length, max); i++) {
        const c = cards[i];

        const name =
          c.querySelector('[data-testid="title"]')?.textContent?.trim() || '';

        // Precio — varios formatos posibles
        const priceEl =
          c.querySelector('[data-testid="price-and-discounted-price"]') ||
          c.querySelector('[data-testid="price-for-x-nights"]') ||
          c.querySelector('.prco-val');
        const price = priceEl?.textContent?.trim() || '';

        // Rating numérico
        const ratingEl = c.querySelector('[data-testid="review-score"]');
        const rating = ratingEl?.textContent?.trim() || '';

        // Dirección
        const addressEl = c.querySelector('[data-testid="address"]');
        const address = addressEl?.textContent?.trim() || '';

        // Link al detalle
        const linkEl = c.querySelector('a[data-testid="title-link"]');
        const link = linkEl?.href || '';

        // Imagen (thumbnail)
        const imgEl = c.querySelector('img[data-testid="image"]');
        const image = imgEl?.src || '';

        if (name) {
          hotels.push({ name, price, rating, address, link, image });
        }
      }
      return hotels;
    }, MAX_RESULTS);

    console.log(`✅ Encontrados ${results.length} hoteles`);

    if (OUTPUT === 'csv') {
      console.log('Nombre,Precio,Rating,Dirección');
      results.forEach((h) =>
        console.log(
          `"${h.name.replace(/"/g, '""')}","${h.price.replace(/"/g, '""')}","${h.rating.replace(/"/g, '""')}","${h.address.replace(/"/g, '""')}"`
        )
      );
    } else {
      console.log(JSON.stringify(results, null, 2));
    }

    await browser.close();
  } catch (err) {
    console.error('❌ Error:', err.message);
    await page
      .screenshot({ path: '/work/booking-scraper/error.png', fullPage: true })
      .catch(() => {});
    await browser.close();
    process.exit(1);
  }
})();
