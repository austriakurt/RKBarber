const puppeteer = require('puppeteer');
const path = require('path');

const diagrams = [
  { file: 'context_diagram.html', name: '1_context_diagram.png' },
  { file: 'erd_diagram.html', name: '2_erd_diagram.png' },
  { file: 'firestore_map.html', name: '3_firestore_collections_map.png' },
  { file: 'architecture_diagram.html', name: '4_system_architecture.png' },
  { file: 'booking_lifecycle.html', name: '5_booking_lifecycle.png' },
];

const BASE_URL = 'http://127.0.0.1:8765';
const OUTPUT_DIR = path.join(__dirname, 'exports');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  for (const diagram of diagrams) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });

    console.log(`Rendering ${diagram.file}...`);
    await page.goto(`${BASE_URL}/${diagram.file}`, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for mermaid to render
    await page.waitForSelector('svg.mermaid', { timeout: 15000 }).catch(() => {
      console.log(`  Warning: svg.mermaid selector not found, trying alternative...`);
    });

    // Extra wait for rendering
    await new Promise(r => setTimeout(r, 2000));

    // Find the rendered SVG and screenshot just that element
    const svgElement = await page.$('svg') || await page.$('#diagram svg') || await page.$('.mermaid svg');

    if (svgElement) {
      const outputPath = path.join(OUTPUT_DIR, diagram.name);
      await svgElement.screenshot({ path: outputPath, type: 'png', omitBackground: false });
      console.log(`  ✓ Saved: ${outputPath}`);
    } else {
      // Fallback: full page screenshot
      const outputPath = path.join(OUTPUT_DIR, diagram.name);
      await page.screenshot({ path: outputPath, fullPage: true, type: 'png' });
      console.log(`  ✓ Saved (full page): ${outputPath}`);
    }

    await page.close();
  }

  await browser.close();
  console.log('\nAll diagrams exported!');
})();
