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
  let activeFfmpegItem = null;

  const converters = {
    'heic-jpg': { inputLabel: 'HEIC or HEIF', extension: 'jpg', mime: 'image/jpeg', quality: 'Full-quality JPG output', engine: 'heic' },
    'heic-png': { inputLabel: 'HEIC or HEIF', extension: 'png', mime: 'image/png', quality: 'Lossless PNG output', engine: 'heic' },
    'webp-jpg': { inputLabel: 'WebP', extension: 'jpg', mime: 'image/jpeg', quality: 'Full-quality JPG output', engine: 'raster' },
    'webp-png': { inputLabel: 'WebP', extension: 'png', mime: 'image/png', quality: 'Lossless PNG output', engine: 'raster' },
    'image-pdf': { inputLabel: 'JPG, PNG or HEIC', extension: 'pdf', mime: 'application/pdf', quality: 'Original-size image PDF output', engine: 'image-pdf' },
    'docx-pdf': { inputLabel: 'Word DOCX', extension: 'pdf', mime: 'application/pdf', quality: 'Locally rendered PDF output', engine: 'docx' },
    'pages-pdf': { inputLabel: 'Apple Pages', extension: 'pdf', mime: 'application/pdf', quality: 'Uses the document’s embedded PDF preview', engine: 'pages' },
    'wav-mp3': { inputLabel: 'WAV', extension: 'mp3', mime: 'audio/mpeg', quality: 'High-quality 320 kbps MP3 output', engine: 'lame' },
    'flac-wav': { inputLabel: 'FLAC', extension: 'wav', mime: 'audio/wav', quality: 'Lossless-quality 24-bit WAV output', engine: 'flac', args: ['-c:a', 'pcm_s24le'] },
    'mov-mp4': { inputLabel: 'MOV', extension: 'mp4', mime: 'video/mp4', quality: 'Fast conversion when streams are MP4-compatible', engine: 'ffmpeg', fastArgs: ['-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart'], args: ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart'] }
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

  function floatToPcm16(samples) {
    const pcm = new Int16Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index]));
      pcm[index] = sample < 0 ? sample * 32768 : sample * 32767;
    }
    return pcm;
  }

  async function resampleAudio(buffer, sampleRate) {
    if (buffer.sampleRate === sampleRate && buffer.numberOfChannels <= 2) return buffer;
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineContext) throw new Error('This browser cannot prepare the WAV audio for MP3 conversion.');
    const channels = Math.min(2, buffer.numberOfChannels);
    const context = new OfflineContext(channels, Math.ceil(buffer.duration * sampleRate), sampleRate);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
    return context.startRendering();
  }

  async function convertWavToMp3(item) {
    if (!window.lamejs || typeof window.lamejs.Mp3Encoder !== 'function') {
      throw new Error('The MP3 converter could not load.');
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('This browser cannot decode WAV audio.');
    const context = new AudioContextClass();
    let stage = 'decode';
    try {
      const decoded = await context.decodeAudioData(await item.file.arrayBuffer());
      const targetRate = Math.min(48000, decoded.sampleRate);
      const audio = await resampleAudio(decoded, targetRate);
      stage = 'encode';
      const channels = Math.min(2, audio.numberOfChannels);
      const left = floatToPcm16(audio.getChannelData(0));
      const right = channels === 2 ? floatToPcm16(audio.getChannelData(1)) : null;
      const encoder = new window.lamejs.Mp3Encoder(channels, audio.sampleRate, 320);
      const chunks = [];
      const blockSize = 1152;
      for (let offset = 0; offset < left.length; offset += blockSize) {
        const encoded = channels === 2
          ? encoder.encodeBuffer(left.subarray(offset, offset + blockSize), right.subarray(offset, offset + blockSize))
          : encoder.encodeBuffer(left.subarray(offset, offset + blockSize));
        if (encoded.length) chunks.push(new Uint8Array(encoded));
        if (offset % (blockSize * 100) === 0) {
          item.status = `Converting… ${Math.round((offset / left.length) * 100)}%`;
          render();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      const finalChunk = encoder.flush();
      if (finalChunk.length) chunks.push(new Uint8Array(finalChunk));
      return new Blob(chunks, { type: 'audio/mpeg' });
    } catch (error) {
      const message = new Error(stage === 'decode'
        ? 'This browser could not decode the WAV file.'
        : `MP3 encoding failed: ${error.message || 'unknown encoder error'}`);
      message.userMessage = true;
      throw message;
    } finally {
      if (typeof context.close === 'function') await context.close();
    }
  }

  function audioBufferToWav24(audio) {
    const bytesPerSample = 3;
    const dataSize = audio.length * audio.numberOfChannels * bytesPerSample;
    if (dataSize > 0xffffffff - 44) throw new Error('This FLAC file is too large for the WAV format.');
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const text = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, audio.numberOfChannels, true);
    view.setUint32(24, audio.sampleRate, true);
    view.setUint32(28, audio.sampleRate * audio.numberOfChannels * bytesPerSample, true);
    view.setUint16(32, audio.numberOfChannels * bytesPerSample, true);
    view.setUint16(34, 24, true);
    text(36, 'data');
    view.setUint32(40, dataSize, true);
    const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
    let offset = 44;
    for (let frame = 0; frame < audio.length; frame += 1) {
      for (let channel = 0; channel < channels.length; channel += 1) {
        const sample = Math.max(-1, Math.min(1, channels[channel][frame]));
        let value = Math.round(sample < 0 ? sample * 8388608 : sample * 8388607);
        if (value < 0) value += 0x1000000;
        view.setUint8(offset, value & 0xff);
        view.setUint8(offset + 1, (value >> 8) & 0xff);
        view.setUint8(offset + 2, (value >> 16) & 0xff);
        offset += bytesPerSample;
      }
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  async function convertFlacToWav(item) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('This browser cannot decode FLAC audio.');
    const context = new AudioContextClass();
    try {
      item.status = 'Decoding FLAC locally…';
      render();
      const decoded = await context.decodeAudioData(await item.file.arrayBuffer());
      item.status = 'Creating 24-bit WAV…';
      render();
      return audioBufferToWav24(decoded);
    } catch (error) {
      item.status = 'Loading fallback FLAC converter…';
      render();
      return convertWithFfmpeg(item, converters['flac-wav']);
    } finally {
      if (typeof context.close === 'function') await context.close();
    }
  }

  async function getFfmpeg() {
    if (!window.FFmpegWASM || typeof window.FFmpegWASM.FFmpeg !== 'function') {
      throw new Error('The local video converter wrapper did not load.');
    }
    if (!ffmpeg) {
      ffmpeg = new window.FFmpegWASM.FFmpeg();
      ffmpeg.on('progress', ({ progress }) => {
        if (activeFfmpegItem && Number.isFinite(progress) && progress >= 0) {
          activeFfmpegItem.status = `Converting… ${Math.min(99, Math.round(progress * 100))}%`;
          render();
        }
      });
    }
    if (!ffmpeg.loaded) {
      const coreBase = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
      const localBlobUrl = async (url, mime) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`The video processing core returned HTTP ${response.status}.`);
        return URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: mime }));
      };
      await ffmpeg.load({
        coreURL: await localBlobUrl(`${coreBase}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await localBlobUrl(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm')
      });
    }
    return ffmpeg;
  }

  async function convertWithFfmpeg(item, converter) {
    const engine = await getFfmpeg();
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const sourceExtension = item.file.name.includes('.') ? item.file.name.split('.').pop() : 'bin';
    const inputName = `input-${token}.${sourceExtension}`;
    const outputName = `output-${token}.${converter.extension}`;
    activeFfmpegItem = item;
    try {
      await engine.writeFile(inputName, new Uint8Array(await item.file.arrayBuffer()));
      let exitCode;
      if (converter.fastArgs) {
        item.status = 'Fast conversion without re-encoding…';
        render();
        exitCode = await engine.exec(['-i', inputName, ...converter.fastArgs, outputName]);
        if (exitCode !== 0) {
          try { await engine.deleteFile(outputName); } catch (error) { /* No partial output was created. */ }
          item.status = 'Streams need re-encoding…';
          render();
          exitCode = await engine.exec(['-i', inputName, ...converter.args, outputName]);
        }
      } else {
        exitCode = await engine.exec(['-i', inputName, ...converter.args, outputName]);
      }
      if (exitCode !== 0) throw new Error(`Video conversion stopped with code ${exitCode}.`);
      const data = await engine.readFile(outputName);
      return new Blob([data.buffer], { type: converter.mime });
    } finally {
      activeFfmpegItem = null;
      try { await engine.deleteFile(inputName); } catch (error) { /* Input was not written. */ }
      try { await engine.deleteFile(outputName); } catch (error) { /* Conversion did not finish. */ }
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
        } else if (converter.engine === 'lame') {
          item.status = 'Decoding WAV locally…';
          render();
          item.blob = await convertWavToMp3(item);
        } else if (converter.engine === 'flac') {
          item.blob = await convertFlacToWav(item);
        } else {
          item.status = ffmpeg && ffmpeg.loaded ? 'Converting…' : 'Loading local converter…';
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
          : converter.engine === 'ffmpeg'
            ? `MOV conversion failed: ${error.message || 'unknown video error'}`
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
