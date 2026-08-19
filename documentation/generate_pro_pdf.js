const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
  try {
    const browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: 'new'
    });
    const page = await browser.newPage();
    const filePath = `file:///${path.resolve('deck_pro.html').replace(/\\/g, '/')}`;
    
    console.log('Loading HTML...', filePath);
    await page.goto(filePath, { waitUntil: 'networkidle0' });
    
    console.log('Generating PDF...');
    await page.pdf({ 
      path: 'Clozflow_Strategic_Pitch_Deck_Pro.pdf', 
      printBackground: true,
      width: '1920px',
      height: '1080px',
      pageRanges: ''
    });
    
    await browser.close();
    console.log('Done! Generated Clozflow_Strategic_Pitch_Deck_Pro.pdf');
  } catch (err) {
    console.error('Error generating PDF:', err);
  }
})();
