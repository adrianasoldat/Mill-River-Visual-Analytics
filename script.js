// ── State ─────────────────────────────────────────────
let correlationsData = {};
let mergedData = [];
let anomaliesOnly = false;

const ENV_KEYS = ['cond', 'flow', 'DO', 'waterTemp', 'precip', 'discharge'];
const ENV_LABELS = ['Conductivity', 'Flow', 'Dissolved O₂', 'Water Temp', 'Precip', 'Discharge'];

const isValid = v => Number.isFinite(v);

// ── Load data ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [corrArray, merged] = await Promise.all([
      fetch('correlations.json').then(r => r.json()),
      fetch('merged_data.json').then(r => r.json())
    ]);

    correlationsData = Object.fromEntries(
      corrArray.map(row => [row.organism, row])
    );
    mergedData = merged;

    renderHeatmap();
    setupEventListeners();

  } catch (err) {
    document.getElementById('heatmap').innerHTML =
      `<p style="color:red">Could not load data<br>Run: python3 -m http.server 8000</p>`;
  }
});

// ── Navigation ────────────────────────────────────────
function showSection(id) {
  document.querySelectorAll('.hli-section')
    .forEach(s => s.classList.add('hidden-section'));

  document.getElementById(id)
    .classList.remove('hidden-section');
}

// ── Events ───────────────────────────────────────────
function setupEventListeners() {
  document.getElementById('anomaliesOnly')
    .addEventListener('change', e => {
      anomaliesOnly = e.target.checked;
      applyAnomalyFilter();
    });
}

// ── Heatmap ──────────────────────────────────────────
function renderHeatmap() {
  const container = document.getElementById('heatmap');
  const families = Object.keys(correlationsData).sort();

  const table = document.createElement('table');
  table.className = 'heatmap-table';

  // Header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.appendChild(document.createElement('th'));

  ENV_LABELS.forEach(label => {
    const th = document.createElement('th');
    th.className = 'col-label';
    th.textContent = label;
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');

  families.forEach(family => {
    const tr = document.createElement('tr');
    tr.setAttribute('data-family-row', family);

    const values = ENV_KEYS.map(k => correlationsData[family]?.[k]);
    const hasStrong = values.some(v => isValid(v) && Math.abs(v) >= 0.3);
    tr.hasStrong = hasStrong;

    // Row label
    const labelTd = document.createElement('td');
    labelTd.className = 'row-label';
    labelTd.textContent = family;
    tr.appendChild(labelTd);

    // Cells
    ENV_KEYS.forEach((key, i) => {
      const value = correlationsData[family]?.[key];
      tr.appendChild(createCell(value, family, key, ENV_LABELS[i]));
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.innerHTML = '';
  container.appendChild(table);
}

// ── Cell creation ─────────────────────────────────────
function createCell(value, family, key, label) {
  const td = document.createElement('td');
  td.className = 'heatmap-cell';

  if (!isValid(value)) {
    td.classList.add('na-cell');
    td.textContent = '—';
    return td;
  }

  td.textContent = value.toFixed(2);
  td.style.background = getColor(value);

  if (Math.abs(value) >= 0.3) {
    td.classList.add('clickable');
    td.onclick = () => showDetail(family, key, label, value);
  }

  return td;
}

// ── Color ────────────────────────────────────────────
function getColor(v) {
  const intensity = Math.min(Math.abs(v), 1);
  return v < 0
    ? `rgba(220, 90, 90, ${intensity})`
    : `rgba(90, 120, 220, ${intensity})`;
}

// ── Filter ───────────────────────────────────────────
function applyAnomalyFilter() {
  document.querySelectorAll('tr[data-family-row]').forEach(tr => {
    tr.style.display = (anomaliesOnly && !tr.hasStrong) ? 'none' : '';
  });
}

// ── Detail panel ─────────────────────────────────────
function showDetail(family, key, label, r) {
  const points = mergedData
    .filter(row => row.family?.toLowerCase() === family.toLowerCase())
    .map(row => ({ x: row[key], y: row.density }))
    .filter(p => isValid(p.x) && isValid(p.y));

  if (!points.length) return;

  document.getElementById('detailTitle').textContent = `${family} × ${label}`;
  document.getElementById('detailR').textContent = `r = ${r.toFixed(3)}`;
  document.getElementById('detailStrength').textContent = getStrengthLabel(r);

  document.getElementById('detailEmpty').classList.add('hidden');
  document.getElementById('detailContent').classList.remove('hidden');

  drawScatter(points, label);
}

function getStrengthLabel(r) {
  const a = Math.abs(r);
  const dir = r > 0 ? 'positive' : 'negative';

  if (a >= 0.7) return `Strong ${dir} correlation`;
  if (a >= 0.5) return `Moderate ${dir} correlation`;
  return `Weak ${dir} correlation`;
}

// ── Scatter ──────────────────────────────────────────
function drawScatter(points, label) {
  const canvas = document.getElementById('scatterPlot');
  const ctx = canvas.getContext('2d');

  const W = canvas.width, H = canvas.height, PAD = 45;
  ctx.clearRect(0, 0, W, H);

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);

  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);

  const xRange = xMax - xMin;
  const yRange = yMax - yMin;

  const toX = v => PAD + (xRange === 0 ? 0.5 : (v - xMin) / xRange) * (W - PAD * 2);
  const toY = v => H - PAD - (yRange === 0 ? 0.5 : (v - yMin) / yRange) * (H - PAD * 2);

  // Axes
  ctx.strokeStyle = '#999';
  ctx.beginPath();
  ctx.moveTo(PAD, PAD);
  ctx.lineTo(PAD, H - PAD);
  ctx.lineTo(W - PAD, H - PAD);
  ctx.stroke();

  // Points
  ctx.fillStyle = 'rgba(42, 100, 150, 0.65)';
  points.forEach(p => {
    ctx.beginPath();
    ctx.arc(toX(p.x), toY(p.y), 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // Label
  ctx.fillStyle = '#666';
  ctx.font = '11px Georgia';
  ctx.textAlign = 'center';
  ctx.fillText(label, W / 2, H - 6);
}