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
          try { rows.push(JSON.parse(trimmed)); } catch (e) {}
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

    // ✨ SMART PARSING LOGIC ✨
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
    rawRecords = data;
  } else if (typeof data === 'object' && data !== null) {
    const values = Object.values(data);
    const isDictionary = values.length > 0 && (typeof values[0] !== 'object' || Array.isArray(values[0]));

    if (isDictionary) {
      // Case: {"word": "meaning"}
      rawRecords = Object.entries(data).map(([key, value]) => ({
        Word: key,
        Meaning: Array.isArray(value) ? value.join(', ') : value
      }));
    } else {
      // Check for common array property names
      let foundArray = null;
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key]) && data[key].length > 0 && typeof data[key][0] === 'object') {
          foundArray = data[key]; break;
        }
      }
      rawRecords = foundArray ? foundArray : [data];
    }
  }

  // 2. Flatten & Extract Smart Details (Word, Meaning, POS)
  let normalizedRows = [];
  let columns = new Set();

  rawRecords.forEach(item => {
    if (typeof item !== 'object' || item === null) {
      let row = { "Value": item };
      normalizedRows.push(row);
      columns.add("Value");
    } else {
      // Step A: Flatten nested objects
      let flatItem = flattenObject(item);
      
      // Step B: Extract Parts of Speech & Standardize Keys
      flatItem = extractSmartDetails(flatItem);

      normalizedRows.push(flatItem);
      Object.keys(flatItem).forEach(k => columns.add(k));
    }
  });

  currentData = normalizedRows;
  currentColumns = Array.from(columns);
}

/* ---------- Flatten Recursive JSON ---------- */
function flattenObject(obj, prefix = '') {
  let result = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) {
      result[newKey] = "";
    } else if (Array.isArray(value)) {
      const isPrimitive = value.every(v => v === null || typeof v !== 'object');
      result[newKey] = isPrimitive ? value.join(', ') : JSON.stringify(value);
    } else if (typeof value === 'object') {
      Object.assign(result, flattenObject(value, newKey));
    } else {
      result[newKey] = value;
    }
  }
  return result;
}

/* ---------- ✨ Smart POS Extractor & Standardizer ✨ ---------- */
function extractSmartDetails(row) {
  let extractedPOS = new Set();
  
  // Keys that usually contain meanings
  const meaningKeys = ['bn', 'meaning', 'en_meaning', 'definition', 'translation', 'meaning_value'];

  for (let key in row) {
    if (typeof row[key] === 'string') {
      // 1. POS Extraction (Looking for words like (Adj.), (Noun), (Adv.))
      if (meaningKeys.some(mk => key.toLowerCase().includes(mk)) || key === 'Bn') {
        const posRegex = /\((Adj|Adv|Noun|Verb|Pron|Prep|Conj|Interj)\.?\)/gi;
        const posMatches = row[key].match(posRegex);
        
        if (posMatches) {
          posMatches.forEach(p => extractedPOS.add(p.replace(/[()]/g, '').trim()));
          // Remove POS from meaning string and clean up extra commas
          row[key] = row[key].replace(posRegex, '').replace(/,\s*,/g, ',').replace(/^,\s*|,\s*$/g, '').trim();
        }
      }
    }
  }

  // 2. Standardize common keys for better column names
  if (row['en'] !== undefined) { row['Word (English)'] = row['en']; delete row['en']; }
  if (row['bn'] !== undefined) { row['Meaning (Bengali)'] = row['bn']; delete row['bn']; }
  if (row['idiom'] !== undefined) { row['Idiom'] = row['idiom']; delete row['idiom']; }
  
  // Add Parts of Speech column if found
  if (extractedPOS.size > 0) {
    row['Parts of Speech'] = Array.from(extractedPOS).join(', ');
  }

  return row;
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

  const columns = currentColumns.map(col => {
    let colDef = {
      title: col,
      field: col,
      minWidth: 120,
      widthGrow: 1,
      formatter: function(cell) {
        let val = cell.getValue();
        return (val === undefined || val === null) ? "" : val;
      }
    };

    // Make meaning/idiom columns wider
    const wideCols = ["Meaning", "En_meaning", "Bengali", "Definition", "Idiom", "Examples", "Parts of Speech"];
    if (wideCols.some(w => col.toLowerCase().includes(w.toLowerCase()))) {
      colDef.widthGrow = 3;
      colDef.minWidth = 200;
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
      row.getElement().style.whiteSpace = "pre-wrap";
      row.getElement().style.wordWrap = "break-word";
    }
  });

  rowCountEl.textContent = currentData.length.toLocaleString();
  colCountEl.textContent = currentColumns.length;
}

/* ---------- Download CSV ---------- */
downloadBtn.addEventListener('click', () => {
  if (!table) return;
  table.download("csv", "converted_data_" + Date.now() + ".csv", {
    bom: true, 
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
