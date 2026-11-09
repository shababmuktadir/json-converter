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

let table = null; 
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

    let rawParsedData = [];

    if (isJsonl) {
      let rows = [];
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
            rows.push(JSON.parse(trimmed));
          } catch (e) { /* ignore invalid line */ }
        }
        updateProgress(bytesRead, totalSize, totalSizeMB);
        await new Promise(r => setTimeout(r));
      }
      if (buffer.trim()) {
        try { rows.push(JSON.parse(buffer.trim())); } catch (e) {}
      }
      rawParsedData = rows;
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
      rawParsedData = JSON.parse(text);
    }

    // ✨ SMART PARSING LOGIC (ANY TYPE OF JSON) ✨
    processSmartData(rawParsedData);
    
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

/* ---------- Universal Smart Parser ---------- */
function processSmartData(data) {
  let rawRecords = [];

  // 1. Identify the main array of records
  if (Array.isArray(data)) {
    // Case: [{...}, {...}]
    rawRecords = data;
  } else if (typeof data === 'object' && data !== null) {
    const values = Object.values(data);
    
    // Check if it's a Dictionary-like object (e.g., {"word1": ["meaning1"], "word2": ["meaning2"]})
    const isDictionary = values.length > 0 && (typeof values[0] !== 'object' || Array.isArray(values[0]));

    if (isDictionary) {
      rawRecords = Object.entries(data).map(([key, value]) => ({
        Word_Key: key,
        Meaning_Value: Array.isArray(value) ? value.join(', ') : value
      }));
    } else {
      // Check for common array property names (e.g., {data: [...]}, {items: [...]})
      let foundArray = null;
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key]) && data[key].length > 0 && typeof data[key][0] === 'object') {
          foundArray = data[key];
          break;
        }
      }
      if (foundArray) {
        rawRecords = foundArray;
      } else {
        // It's just a single object
        rawRecords = [data];
      }
    }
  }

  // 2. Flatten each record and extract columns
  let normalizedRows = [];
  let columns = new Set();

  rawRecords.forEach(item => {
    if (typeof item !== 'object' || item === null) {
      // If item is a primitive in an array (e.g., ["a", "b", "c"])
      let row = { "Value": item };
      normalizedRows.push(row);
      columns.add("Value");
    } else {
      let flatItem = flattenObject(item);
      normalizedRows.push(flatItem);
      Object.keys(flatItem).forEach(k => columns.add(k));
    }
  });

  currentData = normalizedRows;
  currentColumns = Array.from(columns);
}

/* ---------- Universal Recursive Flatten ---------- */
function flattenObject(obj, prefix = '') {
  let result = {};
  
  for (const [key, value] of Object.entries(obj)) {
    // Capitalize first letter of key for better CSV headers
    const newKey = prefix ? `${prefix}.${key}` : key.charAt(0).toUpperCase() + key.slice(1);

    if (value === null || value === undefined) {
      result[newKey] = "";
    } else if (Array.isArray(value)) {
      // Array handling: If array of strings/numbers, join them. If array of objects, stringify.
      const isPrimitive = value.every(v => v === null || typeof v !== 'object');
      if (isPrimitive) {
        result[newKey] = value.join(', ');
      } else {
        result[newKey] = JSON.stringify(value);
      }
    } else if (typeof value === 'object') {
      // Nested object handling (recursive)
      Object.assign(result, flattenObject(value, newKey));
    } else {
      result[newKey] = value;
    }
  }
  return result;
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

/* ---------- Render Tabulator Table ---------- */
function renderTable() {
  tableWrapper.classList.remove('hidden');
  
  if (table) table.destroy();

  // Generate dynamic columns
  const columns = currentColumns.map(col => {
    let colDef = {
      title: col,
      field: col,
      minWidth: 120,
      widthGrow: 1,
      formatter: function(cell) {
        let val = cell.getValue();
        if (val === undefined || val === null) return "";
        return val;
      }
    };

    // Make specific columns wider for better readability
    const wideCols = ["Meaning", "En_meaning", "Bn", "Definition", "Idiom", "Examples"];
    if (wideCols.some(w => col.toLowerCase().includes(w.toLowerCase()))) {
      colDef.widthGrow = 3;
      colDef.minWidth = 250;
    }
    return colDef;
  });

  table = new Tabulator("#data-table", {
    data: currentData,
    columns: columns,
    layout: "fitDataFill",
    height: "70vh",
    pagination: "local",
    paginationSize: 50,
    paginationSizeSelector: [25, 50, 100, 500, true],
    placeholder: "No Data Available",
    resizableRows: true, 
    rowFormatter: function(row) {
      // Automatic text wrapping for long texts (Bengali/Japanese/Chinese)
      row.getElement().style.whiteSpace = "pre-wrap";
      row.getElement().style.wordWrap = "break-word";
    }
  });

  rowCountEl.textContent = currentData.length.toLocaleString();
  colCountEl.textContent = currentColumns.length;
}

/* ---------- Download CSV via Tabulator ---------- */
downloadBtn.addEventListener('click', () => {
  if (!table) return;
  table.download("csv", "converted_data_" + Date.now() + ".csv", {
    bom: true, // Essential for Excel to properly read Bengali, Japanese, Chinese characters
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
