const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const progressFill = document.getElementById('progressFill');
const controls = document.getElementById('controls');
const tableWrapper = document.getElementById('tableWrapper');
const table = document.getElementById('previewTable');
const rowCountEl = document.getElementById('rowCount');
const colCountEl = document.getElementById('colCount');
const previewNote = document.getElementById('previewNote');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const delimiterSel = document.getElementById('delimiter');

let currentData = [];     // parsed array of objects
let currentColumns = [];  // union of all keys

/* ---------- Upload handling ---------- */
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

['dragenter','dragover'].forEach(ev =>
  dropZone.addEventListener(ev, e => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  })
);
['dragleave','drop'].forEach(ev =>
  dropZone.addEventListener(ev, e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  })
);
dropZone.addEventListener('drop', e => {
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

/* ---------- Core file processing ---------- */
async function handleFile(file) {
  resetState();
  showStatus('Reading file...', 5);

  const isJsonl = /\.(jsonl|ndjson)$/i.test(file.name);

  try {
    // Stream read to support huge files
    const stream = file.stream();
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');

    let buffer = '';
    let bytesRead = 0;
    const totalSize = file.size;
    const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);

    if (isJsonl) {
      // ---- JSONL: parse line-by-line (stream friendly) ----
      let rows = [];
      let columns = new Set();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytesRead += value.byteLength;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep last partial line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const obj = JSON.parse(trimmed);
            const flat = flatten(obj);
            Object.keys(flat).forEach(k => columns.add(k));
            rows.push(flat);
          } catch (e) {
            console.warn('Skipping invalid line:', trimmed.slice(0, 80));
          }
        }

        updateProgress(bytesRead, totalSize, totalSizeMB);
        // yield to UI
        await new Promise(r => setTimeout(r));
      }

      // leftover
      if (buffer.trim()) {
        try {
          const obj = JSON.parse(buffer.trim());
          const flat = flatten(obj);
          Object.keys(flat).forEach(k => columns.add(k));
          rows.push(flat);
        } catch (e) { /* ignore */ }
      }

      currentData = rows;
      currentColumns = Array.from(columns);
    } else {
      // ---- Standard JSON: read whole file ----
      const chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytesRead += value.byteLength;
        chunks.push(value);
        updateProgress(bytesRead, totalSize, totalSizeMB);
        await new Promise(r => setTimeout(r));
      }
      const text = new TextDecoder('utf-8').decode(await new Blob(chunks).arrayBuffer());
      let parsed = JSON.parse(text);

      // find array
      let arr = null;
      if (Array.isArray(parsed)) arr = parsed;
      else if (typeof parsed === 'object') {
        // find first array property
        for (const k of Object.keys(parsed)) {
          if (Array.isArray(parsed[k])) { arr = parsed[k]; break; }
        }
        if (!arr) arr = [parsed]; // single object
      }

      // flatten each item
      const rows = arr.map(item =>
        (typeof item === 'object' && item !== null) ? flatten(item) : { value: item }
      );

      const columns = new Set();
      rows.forEach(r => Object.keys(r).forEach(k => columns.add(k)));

      currentData = rows;
      currentColumns = Array.from(columns);
    }

    if (!currentData.length) {
      showStatus('❌ No valid records found in file.', 100);
      return;
    }

    hideStatus();
    renderTable();
    showControls();
    previewNote.textContent =
      `Showing first 100 rows (out of ${currentData.length.toLocaleString()}). Full data will be exported.`;
  } catch (err) {
    console.error(err);
    showStatus('❌ Parse error: ' + err.message, 100);
  }
}

/* ---------- Progress ---------- */
function updateProgress(read, total, totalMB) {
  const pct = Math.min(100, Math.round((read / total) * 100));
  showStatus(`Parsing... ${pct}% of ${totalMB} MB`, pct);
}
function showStatus(text, pct) {
  statusEl.classList.remove('hidden');
  statusText.textContent = text;
  progressFill.style.width = pct + '%';
}
function hideStatus() { statusEl.classList.add('hidden'); }

/* ---------- Flatten nested objects ---------- */
function flatten(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object') {
    out[prefix] = obj;
    return out;
  }
  if (Array.isArray(obj)) {
    // arrays become JSON strings (safer for CSV)
    out[prefix] = JSON.stringify(obj);
    return out;
  }
  for (const key of Object.keys(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      flatten(val, newKey, out);
    } else {
      out[newKey] = val;
    }
  }
  return out;
}

/* ---------- Render preview table ---------- */
function renderTable() {
  const thead = table.querySelector('thead tr');
  const tbody = table.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  // header
  currentColumns.forEach(col => {
    const th = document.createElement('th');
    th.textContent = col;
    thead.appendChild(th);
  });

  // first 100 rows only for preview performance
  const previewLimit = 100;
  const previewRows = currentData.slice(0, previewLimit);

  const frag = document.createDocumentFragment();
  previewRows.forEach(row => {
    const tr = document.createElement('tr');
    currentColumns.forEach(col => {
      const td = document.createElement('td');
      const v = row[col];
      td.textContent = v === undefined || v === null
        ? ''
        : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      tr.appendChild(td);
    });
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);

  rowCountEl.textContent = currentData.length.toLocaleString();
  colCountEl.textContent = currentColumns.length;

  tableWrapper.classList.remove('hidden');
}

/* ---------- CSV export ---------- */
downloadBtn.addEventListener('click', () => {
  if (!currentData.length) return;

  const delim = delimiterSel.value === '\\t' ? '\t' : delimiterSel.value;
  const header = currentColumns.map(c => escapeCSV(c, delim)).join(delim);

  const lines = [header];
  for (const row of currentData) {
    const line = currentColumns.map(c => {
      const v = row[c];
      if (v === undefined || v === null) return '';
      if (typeof v === 'object') return escapeCSV(JSON.stringify(v), delim);
      return escapeCSV(String(v), delim);
    }).join(delim);
    lines.push(line);
  }

  const csv = '\uFEFF' + lines.join('\n'); // BOM for Excel UTF-8
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'converted_' + Date.now() + '.csv';
  a.click();
  URL.revokeObjectURL(url);
});

function escapeCSV(str, delim) {
  if (str === '') return '';
  const needsQuote =
    str.includes(delim) || str.includes('"') ||
    str.includes('\n') || str.includes('\r');
  const escaped = str.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

/* ---------- UI helpers ---------- */
function showControls() { controls.classList.remove('hidden'); }
function resetState() {
  currentData = [];
  currentColumns = [];
  controls.classList.add('hidden');
  tableWrapper.classList.add('hidden');
  previewNote.textContent = '';
  hideStatus();
  fileInput.value = '';
}

resetBtn.addEventListener('click', resetState);