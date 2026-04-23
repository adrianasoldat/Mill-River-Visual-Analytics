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



//scatterplot with highlight
const margin = 100; 
const frameWidth = 1500; 
const frameHeight = 700; 
const visWidth = (frameWidth - 3*margin) / 2; 
const visHeight = (frameHeight - 2*margin); 

let frame = d3.select("#scatterplot_env")
                .append("svg")
                    .attr("width", frameWidth)
                    .attr("height", frameHeight);

let frame1 = frame.append('g')
                    .attr("transform", "translate(" + margin + "," + margin + ")"); 
let frame2 = frame.append('g')
                    .attr("transform", "translate(" + (margin*2 + visWidth) + "," + margin + ")"); 

// to plot
let x1 = 'Water Temperature'
let y1 = 'Dissolved O₂'

let x2 = 'Water Temperature'
let y2 = 'Dissolved O₂'

//

// plot function 



//how to carch errors when loading json -> https://blog.stackademic.com/loading-json-data-in-d3-js-6859e7a71a1d

d3.json("merged_data.json")
        .then(function(data) {
              

  // set up axes
    let xScale1 = d3.scaleLinear()
                    .domain(d3.extent(data, d => d.waterTemp)).nice()
                    .range([0, visWidth]);
    let xScale2 = d3.scaleLinear()
                    .domain(d3.extent(data, d => d.waterTemp)).nice()
                    .range([0, visWidth]); 
    let yScale1 = d3.scaleLinear()
                    .domain(d3.extent(data, d => d.DO)).nice()
                    .range([visHeight, 0]); 
    let yScale2 = d3.scaleLinear()
                    .domain(d3.extent(data, d => d.DO)).nice()
                    .range([visHeight, 0]);
    
    let xAxis1 = d3.axisBottom(xScale1); 
    let xAxis2 = d3.axisBottom(xScale2); 
    let yAxis1 = d3.axisLeft(yScale1); 
    let yAxis2 = d3.axisLeft(yScale2); 



   // Add axes  
    // scatter 1
    frame1.append('g')
            .attr('transform', 'translate(0,' + (visHeight) + ')')
            .call(xAxis1)
    frame1.append("text")             
            .attr('transform', 'translate(' + (visWidth/2) + ',' + (visHeight + margin/2) + ')')
            .style("text-anchor", "middle")
            .text(x1);
             
    frame1.append('g')
            .call(yAxis1); 
    frame1.append("text")   
            .attr("transform", "rotate(-90)")          
            .attr('x', -visHeight/2)
            .attr('y', -margin/2)
            .style("text-anchor", "middle")
            .text(y1);

  // scatter 2
    frame2.append('g')
            .attr('transform', 'translate(0,' + (visHeight) + ')')
            .call(xAxis2); 
    frame2.append("text")             
            .attr('transform', 'translate(' + (visWidth/2) + ',' + (visHeight + margin/2) + ')')
            .style("text-anchor", "middle")
            .text(x2);

    frame2.append('g')
            .call(yAxis2); 
    frame2.append("text")   
            .attr("transform", "rotate(-90)")          
            .attr('x', -visHeight/2)
            .attr('y', -margin/2)
            .style("text-anchor", "middle")
            .text(y2);


   // set up color scale for feeding groups 
    let feeding_colors = d3.scaleOrdinal()
                            .domain(data.map(d => d['feedingGroup']))
                            .range(['lightpink','red','blue','black', 'orange','green']); 



 brush = d3.brush()
                .extent([ // define what can be brushed 
                    [d3.min(xScale1.range()), d3.min(yScale1.range())],
                    [d3.max(xScale1.range()), d3.max(yScale1.range())]
                ])
                .on("brush end", (e) => { // event handler 
                    if (e.selection === null) {
                        circles = d3.selectAll('circle'); 
                        circles = circles["_groups"][0]; 
                        circles.forEach(c => { c.classList.remove('highlight'); })
                    } else {
                        const [[xMin, yMin], [xMax, yMax]] = e.selection; 
                        data.map((d, i) => {
                            
                            selector = "._" + i;
                            sel =  d3.selectAll(selector); 
                            circles = sel["_groups"][0] // for each data in selection, find circles
                        
                            if (xMin <= xScale1(d[x1]) && xMax >= xScale1(d[x1]) &&
                                yMin <= yScale1(d[y1]) && yMax >= yScale1(d[y1])) {
                                circles.forEach(c => { c.classList.add('highlight'); }) // if circle is in selection, highlight
                            } else {
                                circles.forEach(c => { c.classList.remove('highlight'); })
                            }
                        })
                    }
                }); 

  frame1.append("g")
        .call(brush); 


 let dot1 = frame1.append('g')
            .selectAll("dot")
            .data(data)
            .enter()
        .append("circle")
               .attr("cx", function (d) { 
                console.log(xScale1(d[x1]))
                return xScale1(d[x1]); })
            .attr("cy", function (d) { 
                return yScale1(d[y1]); })
            .attr("r", 20)
            .style("fill", function (d) { 
                return feeding_colors(d['feedingGroup']) 
            })
            .attr("class", (d, i) => {return "_" + i}); 

  let dot2 = frame2.append('g')

            .selectAll("dot")
            .data(data)
            .enter()
        .append("circle")
            .attr("cx", function (d) { 
                return xScale2(d[x2]); })
            .attr("cy", function (d) { 
                return yScale2(d[y2]); })
            .attr("r", 20)
            .style("fill", function (d) { 
                return feeding_colors(d['feedingGroup']) 
            })
            .attr("class", (d, i) => {return "_" + i});  


console.log(frame1)
console.log(data)

  });
