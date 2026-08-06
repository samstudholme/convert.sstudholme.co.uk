(() => {
  'use strict';

  const measurementId = 'G-Q73D9E0L4B';
  const consentKey = 'analytics-consent';
  const consentLifetime = 180 * 24 * 60 * 60 * 1000;
  const banner = document.getElementById('cookie-banner');
  let analyticsStarted = false;

  function getConsent() {
    try {
      const saved = JSON.parse(localStorage.getItem(consentKey));
      return saved && Date.now() - saved.savedAt < consentLifetime ? saved.choice : null;
    } catch (error) {
      return null;
    }
  }

  function saveConsent(choice) {
    localStorage.setItem(consentKey, JSON.stringify({ choice, savedAt: Date.now() }));
  }

  function startAnalytics() {
    if (analyticsStarted) return;
    analyticsStarted = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied'
    });
    window.gtag('consent', 'update', { analytics_storage: 'granted' });
    window.gtag('js', new Date());
    window.gtag('config', measurementId, { anonymize_ip: true });

    const tag = document.createElement('script');
    tag.async = true;
    tag.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.append(tag);
  }

  function trackConversion(outputFormat) {
    if (!analyticsStarted || getConsent() !== 'accepted') return;
    window.gtag('event', 'file_conversion', {
      output_format: outputFormat === 'jpeg' ? 'jpg' : outputFormat
    });
  }

  function showConsent() {
    banner.hidden = false;
    document.getElementById('accept-analytics').focus();
  }

  function removeAnalyticsCookies() {
    document.cookie.split(';').forEach((entry) => {
      const name = entry.split('=')[0].trim();
      if (name === '_ga' || name.startsWith('_ga_')) {
        document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
      }
    });
  }

  const cookieChoice = getConsent();
  if (cookieChoice === 'accepted') startAnalytics();
  if (!cookieChoice) showConsent();

  document.getElementById('accept-analytics').addEventListener('click', () => {
    saveConsent('accepted');
    startAnalytics();
    banner.hidden = true;
  });

  document.getElementById('reject-analytics').addEventListener('click', () => {
    saveConsent('rejected');
    if (analyticsStarted) {
      window.gtag('consent', 'update', { analytics_storage: 'denied' });
      removeAnalyticsCookies();
      location.reload();
      return;
    }
    banner.hidden = true;
  });

  document.getElementById('cookie-settings').addEventListener('click', showConsent);

  const $ = (selector) => document.querySelector(selector);
  const input = $('#file-input');
  const dropZone = $('#drop-zone');
  const list = $('#file-list');
  const converterSelect = $('#converter-select');
  const dropTitle = $('#drop-title');
  const qualityNote = $('#quality-note');
  const convertButton = $('#convert-button');
  const clearButton = $('#clear-button');
  const errorBox = $('#global-error');
  let items = [];
  let busy = false;
  let ffmpeg = null;

  const converters = {
    'heic-jpg': { inputLabel: 'HEIC or HEIF', extension: 'jpg', mime: 'image/jpeg', quality: 'Full-quality JPG output', engine: 'heic' },
    'heic-png': { inputLabel: 'HEIC or HEIF', extension: 'png', mime: 'image/png', quality: 'Lossless PNG output', engine: 'heic' },
    'webp-jpg': { inputLabel: 'WebP', extension: 'jpg', mime: 'image/jpeg', quality: 'Full-quality JPG output', engine: 'raster' },
    'webp-png': { inputLabel: 'WebP', extension: 'png', mime: 'image/png', quality: 'Lossless PNG output', engine: 'raster' },
    'image-pdf': { inputLabel: 'JPG, PNG or HEIC', extension: 'pdf', mime: 'application/pdf', quality: 'Original-size image PDF output', engine: 'image-pdf' },
    'docx-pdf': { inputLabel: 'Word DOCX', extension: 'pdf', mime: 'application/pdf', quality: 'Locally rendered PDF output', engine: 'docx' },
    'pages-pdf': { inputLabel: 'Apple Pages', extension: 'pdf', mime: 'application/pdf', quality: 'Uses the document’s embedded PDF preview', engine: 'pages' },
    'wav-mp3': { inputLabel: 'WAV', extension: 'mp3', mime: 'audio/mpeg', quality: 'High-quality 320 kbps MP3 output', engine: 'ffmpeg', args: ['-c:a', 'libmp3lame', '-b:a', '320k'] },
    'flac-wav': { inputLabel: 'FLAC', extension: 'wav', mime: 'audio/wav', quality: 'Lossless 24-bit WAV output', engine: 'ffmpeg', args: ['-c:a', 'pcm_s24le'] },
    'mov-mp4': { inputLabel: 'MOV', extension: 'mp4', mime: 'video/mp4', quality: 'High-quality, mobile-compatible MP4 output', engine: 'ffmpeg', args: ['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart'] }
  };

  const heicBrandPattern = /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)$/;
  const hasHeicNameOrType = (file) => /\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);

  async function isHeic(file) {
    if (hasHeicNameOrType(file)) return true;

    // iOS Photos can provide HEIC assets without a useful extension or MIME type.
    // Detect the ISO-BMFF `ftyp` brand so those files are not incorrectly skipped.
    try {
      const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
      if (header.length < 12 || String.fromCharCode(...header.slice(4, 8)) !== 'ftyp') return false;
      const brands = [];
      for (let offset = 8; offset + 4 <= header.length; offset += 4) {
        brands.push(String.fromCharCode(...header.slice(offset, offset + 4)));
      }
      return brands.some((brand) => heicBrandPattern.test(brand));
    } catch (error) {
      return false;
    }
  }

  async function detectConverter(file) {
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();
    if (await isHeic(file)) {
      if (converterSelect.value === 'heic-png' || converterSelect.value === 'image-pdf') return converterSelect.value;
      return 'heic-jpg';
    }
    if (/\.webp$/i.test(name) || type === 'image/webp') return converterSelect.value === 'webp-png' ? 'webp-png' : 'webp-jpg';
    if (/\.(jpe?g|png)$/i.test(name) || /^image\/(jpeg|png)$/.test(type)) return 'image-pdf';
    if (/\.docx$/i.test(name) || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx-pdf';
    if (/\.pages$/i.test(name) || type === 'application/vnd.apple.pages') return 'pages-pdf';
    if (/\.wav$/i.test(name) || /audio\/(x-)?wav/.test(type)) return 'wav-mp3';
    if (/\.flac$/i.test(name) || /audio\/(x-)?flac/.test(type)) return 'flac-wav';
    if (/\.mov$/i.test(name) || type === 'video/quicktime') return 'mov-mp4';
    return null;
  }
  const baseName = (name) => name.replace(/\.[^.]+$/, '');
  const selectedConverter = () => converters[converterSelect.value];
  const showError = (message = '') => {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  };

  function updateButtons() {
    convertButton.disabled = busy || !items.length;
    clearButton.disabled = busy || !items.length;
  }

  function updateConverterCopy() {
    const converter = selectedConverter();
    dropTitle.textContent = `Drop ${converter.inputLabel} files here`;
    qualityNote.textContent = converter.quality;
  }

  function cleanup(item) {
    if (item.url) URL.revokeObjectURL(item.url);
    item.url = null;
  }

  function render() {
    list.replaceChildren(...items.map((item) => {
      const li = document.createElement('li');
      li.className = 'file-item';
      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'file-name';
      name.textContent = item.file.name;
      const status = document.createElement('div');
      status.className = `status${item.error ? ' is-error' : ''}`;
      status.textContent = item.error || item.status;
      info.append(name, status);

      const actions = document.createElement('div');
      actions.className = 'file-actions';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'button button-text';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${item.file.name}`);
      remove.disabled = busy;
      remove.addEventListener('click', () => {
        cleanup(item);
        items = items.filter((entry) => entry !== item);
        render();
      });
      actions.append(remove);
      li.append(info, actions);
      return li;
    }));
    updateButtons();
  }

  async function addFiles(files) {
    showError();
    const selected = [...files];
    if (!selected.length) return;
    const detected = await Promise.all(selected.map(detectConverter));
    const firstSupported = detected.find(Boolean);
    if (firstSupported) {
      if (items.length && firstSupported !== converterSelect.value) {
        items.forEach(cleanup);
        items = [];
      }
      converterSelect.value = firstSupported;
      updateConverterCopy();
    }
    const active = selectedConverter();
    const valid = selected.filter((file, index) => detected[index] === converterSelect.value ||
      (detected[index] && converters[detected[index]].engine === 'heic' && active.engine === 'heic'));
    if (valid.length !== selected.length) showError(`Some files were skipped. This batch requires ${active.inputLabel} files.`);
    valid.forEach((file) => items.push({ file, status: 'Ready', error: '', blob: null, url: null, extension: '' }));
    input.value = '';
    render();
  }

  function downloadItem(item) {
    cleanup(item);
    item.url = URL.createObjectURL(item.blob);
    const link = document.createElement('a');
    link.href = item.url;
    link.download = `${baseName(item.file.name)}.${item.extension}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => cleanup(item), 1000);
  }

  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image.')); };
      image.src = url;
    });
  }

  function canvasBlob(canvas, mime, quality = 1) {
    return new Promise((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Could not create the converted image.')),
      mime,
      quality
    ));
  }

  async function imageCanvas(blob, whiteBackground = false) {
    const image = await loadImage(blob);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (whiteBackground) {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0);
    return canvas;
  }

  async function convertRaster(item, converter) {
    const canvas = await imageCanvas(item.file, converter.mime === 'image/jpeg');
    return canvasBlob(canvas, converter.mime, 1);
  }

  function requirePdfLibrary() {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('The PDF converter could not load.');
    return window.jspdf.jsPDF;
  }

  function canvasesToPdf(canvases) {
    const JsPdf = requirePdfLibrary();
    let pdf;
    canvases.forEach((canvas, index) => {
      const orientation = canvas.width > canvas.height ? 'landscape' : 'portrait';
      if (!pdf) {
        pdf = new JsPdf({ orientation, unit: 'px', format: [canvas.width, canvas.height], hotfixes: ['px_scaling'] });
      } else {
        pdf.addPage([canvas.width, canvas.height], orientation);
      }
      pdf.addImage(canvas, 'JPEG', 0, 0, canvas.width, canvas.height, undefined, 'FAST');
    });
    return pdf.output('blob');
  }

  async function convertImageToPdf(item) {
    let source = item.file;
    if (await isHeic(item.file)) {
      if (typeof window.heic2any !== 'function') throw new Error('The image converter could not load.');
      const result = await window.heic2any({ blob: item.file, toType: 'image/jpeg', quality: 1 });
      source = Array.isArray(result) ? result[0] : result;
    }
    return canvasesToPdf([await imageCanvas(source, true)]);
  }

  async function convertDocxToPdf(item) {
    if (!window.docx || typeof window.docx.renderAsync !== 'function' || typeof window.html2canvas !== 'function') {
      throw new Error('The Word converter could not load.');
    }
    const staging = document.createElement('div');
    staging.className = 'document-staging';
    document.body.append(staging);
    try {
      await window.docx.renderAsync(await item.file.arrayBuffer(), staging, null, { inWrapper: true });
      const pages = [...staging.querySelectorAll('.docx-wrapper > section')];
      if (!pages.length) throw new Error('This Word document could not be rendered.');
      const canvases = [];
      for (const page of pages) {
        canvases.push(await window.html2canvas(page, { backgroundColor: '#fff', scale: 1.5, useCORS: true }));
      }
      return canvasesToPdf(canvases);
    } finally {
      staging.remove();
    }
  }

  async function convertPagesToPdf(item) {
    if (!window.JSZip) throw new Error('The Pages converter could not load.');
    const archive = await window.JSZip.loadAsync(item.file);
    const preview = Object.values(archive.files).find((entry) => !entry.dir && /(^|\/)preview\.pdf$/i.test(entry.name));
    if (!preview) {
      const error = new Error('No PDF preview was found in this Pages document. Export it as PDF from Pages instead.');
      error.userMessage = true;
      throw error;
    }
    return preview.async('blob');
  }

  async function getFfmpeg() {
    if (!window.FFmpeg || typeof window.FFmpeg.createFFmpeg !== 'function') {
      throw new Error('The audio and video converter could not load.');
    }
    if (!ffmpeg) {
      ffmpeg = window.FFmpeg.createFFmpeg({
        log: false,
        corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
      });
    }
    if (!ffmpeg.isLoaded()) await ffmpeg.load();
    return ffmpeg;
  }

  async function convertWithFfmpeg(item, converter) {
    const engine = await getFfmpeg();
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const sourceExtension = item.file.name.includes('.') ? item.file.name.split('.').pop() : 'bin';
    const inputName = `input-${token}.${sourceExtension}`;
    const outputName = `output-${token}.${converter.extension}`;
    engine.setProgress(({ ratio }) => {
      if (Number.isFinite(ratio) && ratio >= 0) {
        item.status = `Converting… ${Math.min(99, Math.round(ratio * 100))}%`;
        render();
      }
    });
    try {
      engine.FS('writeFile', inputName, await window.FFmpeg.fetchFile(item.file));
      await engine.run('-i', inputName, ...converter.args, outputName);
      const data = engine.FS('readFile', outputName);
      return new Blob([data.buffer], { type: converter.mime });
    } finally {
      try { engine.FS('unlink', inputName); } catch (error) { /* Input was not written. */ }
      try { engine.FS('unlink', outputName); } catch (error) { /* Conversion did not finish. */ }
    }
  }

  async function convertAll() {
    busy = true;
    showError();
    updateButtons();
    const converterKey = converterSelect.value;
    const converter = converters[converterKey];

    for (const item of [...items]) {
      cleanup(item);
      item.blob = null;
      item.error = '';
      item.status = 'Converting…';
      render();
      try {
        if (converter.engine === 'heic') {
          if (typeof window.heic2any !== 'function') throw new Error('The image converter could not load.');
          const result = await window.heic2any({ blob: item.file, toType: converter.mime, quality: 1 });
          item.blob = Array.isArray(result) ? result[0] : result;
        } else if (converter.engine === 'raster') {
          item.blob = await convertRaster(item, converter);
        } else if (converter.engine === 'image-pdf') {
          item.blob = await convertImageToPdf(item);
        } else if (converter.engine === 'docx') {
          item.status = 'Rendering document locally…';
          render();
          item.blob = await convertDocxToPdf(item);
        } else if (converter.engine === 'pages') {
          item.status = 'Reading embedded PDF preview…';
          render();
          item.blob = await convertPagesToPdf(item);
        } else {
          item.status = ffmpeg && ffmpeg.isLoaded() ? 'Converting…' : 'Loading local converter…';
          render();
          item.blob = await convertWithFfmpeg(item, converter);
        }
        item.extension = converter.extension;
        item.status = 'Downloading…';
        trackConversion(converter.extension);
        render();
        downloadItem(item);
        items = items.filter((entry) => entry !== item);
      } catch (error) {
        item.error = error && error.userMessage
          ? error.message
          : error && /could not load/i.test(error.message)
          ? `${error.message} Check your connection, then refresh the page.`
          : 'Could not convert this file. It may be damaged, unsupported or too large for this device.';
        item.status = '';
      }
      render();
    }
    busy = false;
    render();
  }

  $('#choose-button').addEventListener('click', (event) => { event.stopPropagation(); input.click(); });
  input.addEventListener('change', () => addFiles(input.files));
  dropZone.addEventListener('click', () => input.click());
  dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); }
  });
  ['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-over');
  }));
  dropZone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));
  convertButton.addEventListener('click', convertAll);
  clearButton.addEventListener('click', () => {
    items.forEach(cleanup);
    items = [];
    showError();
    render();
  });
  converterSelect.addEventListener('change', () => {
    if (items.length) {
      items.forEach(cleanup);
      items = [];
      showError('The previous selection was cleared because the converter changed.');
      render();
    }
    updateConverterCopy();
  });
  updateConverterCopy();
  window.addEventListener('beforeunload', () => items.forEach(cleanup));
})();
