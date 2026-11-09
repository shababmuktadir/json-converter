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

/* ---------- Smart Parser (JSON to Standardized Format) ---------- */
function processSmartData(data) {
  let normalizedRows = [];
  let columns = new Set();

  // Case 1: Array of Objects [{en: "false", bn: "ভুল (Adj.)"}, ...]
  if (Array.isArray(data)) {
    data.forEach(item => {
      if (typeof item !== 'object' || item === null) return;
      
      let row = { "Word (English)": "", "Meaning (Bengali)": "", "Parts of Speech": "", "Other Info": "" };
      
      // Try to find English Word
      row["Word (English)"] = item.en || item.word || item.english || item.term || "";
      
      // Try to find Bengali Meaning
      let meaningText = item.bn || item.meaning || item.translation || item.definition || "";
      
      if (typeof meaningText === 'string') {
        // Extract Parts of Speech inside parentheses like (Adj.), (Adv.), (Noun)
        const posRegex = /\((Adj|Adv|Noun|Verb|Pron|Prep|Conj|Interj)\.?\)/gi;
        const posMatches = meaningText.match(posRegex);
        
        if (posMatches) {
          row["Parts of Speech"] = [...new Set(posMatches.map(p => p.replace(/[()]/g, '')))].join(', ');
          meaningText = meaningText.replace(posRegex, '').trim();
        }

        // Clean up extra commas/spaces
        meaningText = meaningText.replace(/,\s*,/g, ',').replace(/^,\s*|,\s*$/g, '');
        row["Meaning (Bengali)"] = meaningText;
      } else if (Array.isArray(meaningText)) {
        row["Meaning (Bengali)"] = meaningText.join(', ');
      }

      // Capture Synonyms/Antonyms if they exist in the JSON explicitly
      if (item.synonyms) row["Synonyms"] = Array.isArray(item.synonyms) ? item.synonyms.join(', ') : item.synonyms;
      if (item.antonyms) row["Antonyms"] = Array.isArray(item.antonyms) ? item.antonyms.join(', ') : item.antonyms;

      normalizedRows.push(row);
    });
  } 
  // Case 2: Object with Arrays {"a": ["এক", "ইংরেজী..."], "abandon": ["ত্যাগ করা"]}
  else if (typeof data === 'object' && data !== null) {
    for (const [key, value] of Object.entries(data)) {
      let row = { "Word (English)": key, "Meaning (Bengali)": "", "Parts of Speech": "", "Other Info": "" };
      
      if (Array.isArray(value)) {
        row["Meaning (Bengali)"] = value.join(', ');
      } else if (typeof value === 'object' && value !== null) {
        // If value is an object (e.g., {meaning: "...", pos: "..."})
        row["Meaning (Bengali)"] = value.bn || value.meaning || JSON.stringify(value);
        if (value.pos) row["Parts of Speech"] = value.pos;
      } else {
        row["Meaning (Bengali)"] = String(value);
      }
      normalizedRows.push(row);
    }
  }

  // Dynamically collect all keys generated
  normalizedRows.forEach(r => Object.keys(r).forEach(k => columns.add(k)));

  currentData = normalizedRows;
  // Prioritize specific columns first
  const priorityCols = ["Word (English)", "Meaning (Bengali)", "Parts of Speech", "Synonyms", "Antonyms"];
  currentColumns = Array.from(columns).sort((a, b) => {
    let idxA = priorityCols.indexOf(a);
    let idxB = priorityCols.indexOf(b);
    if (idxA === -1) idxA = 99;
    if (idxB === -1) idxB = 99;
    return idxA - idxB;
  });
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

    // Make the meaning column wider
    if (col.includes("Meaning") || col.includes("Synonyms") || col.includes("Antonyms")) {
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
    resizableRows: true, // Allows user to drag row height
    rowFormatter: function(row) {
      // Add automatic text wrapping for long texts
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
  table.download("csv", "dictionary_data_" + Date.now() + ".csv", {
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
