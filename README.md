# Private File Converter

A lightweight, browser-based tool for converting images, audio and video files.

All processing happens locally in the browser. Files are never uploaded to a server or stored in the cloud.

## Features

- Drag-and-drop or file-picker input
- Multiple-file conversion
- Automatic converter selection based on the uploaded file
- HEIC/HEIF to JPG or PNG
- WebP to JPG or PNG
- JPG, PNG or HEIC to PDF
- Word DOCX to locally rendered PDF
- Apple Pages to PDF when an embedded PDF preview is available
- WAV to 320 kbps MP3
- FLAC to lossless 24-bit WAV
- MOV to high-quality MP4
- Automatic downloads
- Responsive dark interface
- Accessible controls and error messages
- Optional, consent-based Google Analytics
- SEO metadata, Open Graph tags and FAQ structured data

## Technology

The site uses plain HTML, CSS and JavaScript. Image and PDF conversion uses heic2any, jsPDF, docx-preview, html2canvas and JSZip; audio and video conversion uses FFmpeg WebAssembly. Everything runs locally in the browser. It has no backend, upload endpoint, accounts, database or build process.

## Run locally

From the project directory, start a static server:

```bash
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

Opening `index.html` directly may work, but a local server more closely matches the published environment.

## Deploy to GitHub Pages

1. Push the project files to a GitHub repository.
2. Open the repository's **Settings → Pages**.
3. Select **Deploy from a branch**.
4. Choose the main branch and the `/ (root)` directory.
5. Save and wait for GitHub to provide the public URL.

The canonical and Open Graph URLs are configured for `https://convert.sstudholme.co.uk/`.

## Analytics and privacy

Google Analytics uses measurement ID `G-Q73D9E0L4B`. The Google tag is not loaded until a visitor explicitly accepts analytics. Visitors can reject analytics or change their choice through **Cookie settings**.

Successful conversions record only a `file_conversion` event and the selected output format. Filenames, image contents and photo metadata are not sent to Analytics.

The consent choice is stored locally for 180 days. A suitable privacy notice identifying the site operator and explaining data processing should be added before public launch.

## Browser notes

- An internet connection is required to load the conversion libraries from jsDelivr. Files themselves are never sent to jsDelivr or any other server.
- Browsers may request permission before allowing multiple automatic downloads.
- Conversion performance can vary with browser, device and file size. Large videos may exceed the memory available to a mobile browser.
- Word conversion is a browser-rendered approximation and complex layouts may differ from Microsoft Word.
- Pages conversion requires a PDF preview embedded in the `.pages` package. Not every Pages document contains one.

## Files

- `index.html` — page content, metadata and structured data
- `styles.css` — responsive dark styling
- `script.js` — conversion, downloads and analytics consent

## Licence

No project licence has been specified.
