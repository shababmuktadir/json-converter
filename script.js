const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const progressFill = document.getElementById('progressFill');
const controls = document.getElementById('controls');
const tableWrapper = document.getElementById('tableWrapper');
const rowCountEl = document.getElementById('rowCount');
const colCountEl = document.getElementById('colCount');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');

let table = null; // Tabulator instance
let currentData = [];
let currentColumns = [];

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
    const stream = file.stream();
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');

    let buffer = '';
    let bytesRead = 0;
    const totalSize = file.size;
    const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);

    if (isJsonl) {
      let rows = [];
      let columns = new Set();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytesRead += value.byteLength;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const obj = JSON.parse(trimmed);
            const flat = flatten(obj);
            Object.keys(flat).forEach(k => columns.add(k));
            rows.push(flat);
          } catch (e) { /* ignore invalid line */ }
        }
        updateProgress(bytesRead, totalSize, totalSizeMB);
        await new Promise(r => setTimeout(r));
      }
      
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
      let arr = Array.isArray(parsed) ? parsed : [parsed];
      
      // If it's an object with one array inside (like Wiktionary dumps)
      if (!Array.isArray(parsed) && typeof parsed === 'object') {
        for (const k of Object.keys(parsed)) {
          if (Array.isArray(parsed[k])) { arr = parsed[k]; break; }
        }
      }

      const rows = arr.map(item => (typeof item === 'object' && item !== null) ? flatten(item) : { value: item });
      const columns = new Set();
      rows.forEach(r => Object.keys(r).forEach(k => columns.add(k)));

      currentData = rows;
      currentColumns = Array.from(columns);
    }

    if (!currentData.length) {
      showStatus('❌ No valid records found.', 100);
      return;
    }

    hideStatus();
    renderTable();
    showControls();
    
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

/* ---------- Flatten Logic ---------- */
// Arrays are kept as pretty JSON strings so they look good in the table, 
// but nested objects are flattened (e.g., etymology.source_language)
function flatten(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object') {
    out[prefix] = obj;
    return out;
  }
  
  if (Array.isArray(obj)) {
    // If it's an array of primitives, join them. If objects, stringify them.
    const isPrimitive = obj.every(v => v === null || typeof v !== 'object');
    if (isPrimitive) {
      out[prefix] = obj.join(', ');
    } else {
      // Stringify arrays of objects with indentation for readability
      out[prefix] = JSON.stringify(obj, null, 1); 
    }
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

/* ---------- Render Tabulator Table ---------- */
function renderTable() {
  tableWrapper.classList.remove('hidden');
  
  // If table already exists, destroy it before creating a new one
  if (table) {
    table.destroy();
  }

  // Generate dynamic columns based on JSON keys
  const columns = currentColumns.map(col => ({
    title: col,
    field: col,
    minWidth: 150, // Prevents columns from becoming too narrow
    widthGrow: 1,
    formatter: function(cell) {
      let val = cell.getValue();
      if (val === undefined || val === null) return "";
      return val;
    }
  }));

  table = new Tabulator("#data-table", {
    data: currentData,
    columns: columns,
    layout: "fitDataFill", // Adjusts column widths automatically
    height: "70vh",        // Fixed height with internal scrolling
    pagination: "local",   // Built-in pagination for massive data
    paginationSize: 50,    // Show 50 rows per page
    paginationSizeSelector: [25, 50, 100, 500, true], // Allow changing page size
    placeholder: "No Data Available",
  });

  rowCountEl.textContent = currentData.length.toLocaleString();
  colCountEl.textContent = currentColumns.length;
}

/* ---------- Download CSV via Tabulator ---------- */
downloadBtn.addEventListener('click', () => {
  if (!table) return;
  // Tabulator has a built-in CSV exporter that handles commas, quotes, and newlines perfectly!
  table.download("csv", "converted_" + Date.now() + ".csv", {
    bom: true, // Add BOM for Excel UTF-8 support (Bengali)
  });
});

/* ---------- UI Helpers ---------- */
function showControls() { controls.classList.remove('hidden'); }
function resetState() {
  currentData = [];
  currentColumns = [];
  controls.classList.add('hidden');
  tableWrapper.classList.add('hidden');
  hideStatus();
  fileInput.value = '';
  if (table) {
    table.destroy();
    table = null;
  }
}

resetBtn.addEventListener('click', resetState);
