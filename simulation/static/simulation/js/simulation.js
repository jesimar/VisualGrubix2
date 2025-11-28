// simulation/static/simulation/js/simulation.js
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

// --- Estado global vindo do backend ---
let worldDim = { x: 600, y: 600 }; // atualizado após /api/state
let radiusComm = 0;

// --- Viewport (em unidades do mundo) ---
const view = {
  x: 0,      // canto esquerdo superior (mundo)
  y: 0,      // canto esquerdo superior (mundo)
  scale: 1,  // px por unidade do mundo
  minScale: 0.02,  // limite de zoom-out (ajuste conforme seu mundo)
  maxScale: 10,    // limite de zoom-in
};

// Fit inicial só uma vez após receber o 1º estado
let didInitialFit = false;

// ---------- UI de nós / rótulos ----------
const ui = {
  nodeSize: 6,         // raio em px (na tela)
  minNodeSize: 2,
  maxNodeSize: 24,
  showIds: false,
  showGraph: false,
  packetStyle: "wave",  // "packet" | "wave"
  showSprites: false,
  showTrails: false,
};

// ------- Sprites por tipo de nó -------
const sprites = {
  REGULAR: new Image(),
  UAV: new Image(),
  INTRUDER: new Image(),
};
sprites.REGULAR.src  = "/static/simulation/img/node-regular.png";
sprites.UAV.src      = "/static/simulation/img/node-uav.png";
sprites.INTRUDER.src = "/static/simulation/img/node-intruder.png";

// preferências
ui.trailAlpha = 0.6;           // opacidade base
ui.trailWidth = 2;             // largura da linha
ui.trailFade = true;           // desvanecer até alpha~0
ui.trailMinScreenStep = 2;     // px mínimos entre pontos pra desenhar

for (const key of Object.keys(sprites)) {
  sprites[key].onload = () => {
    if (ui.showSprites && lastState) 
      draw(lastState);
  };
}

// Restaurar preferências (opcional)
try {
  const saved = JSON.parse(localStorage.getItem("wsn_ui") || "{}");
  if (typeof saved.nodeSize === "number") ui.nodeSize = saved.nodeSize;
  if (typeof saved.showIds === "boolean") ui.showIds = saved.showIds;
  if (typeof saved.showGraph === "boolean") ui.showGraph = saved.showGraph;
  if (typeof saved.packetStyle === "string") ui.packetStyle = saved.packetStyle;
  if (typeof saved.showSprites === "boolean") ui.showSprites = saved.showSprites;
  if (typeof saved.showTrails === "boolean") ui.showTrails = saved.showTrails;
} catch (_) { /* ignore */ }

let lastState = null;

let selectedNodeId = null;

// CSS->px do canvas e conversões
function getCanvasMouse(e) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return {
    sx: (e.clientX - rect.left) * dpr,
    sy: (e.clientY - rect.top) * dpr,
  };
}
function screenToWorld(sx, sy) {
  return { x: view.x + sx / view.scale, y: view.y + sy / view.scale };
}

// Pick: pega o nó mais próximo dentro de um raio de clique em pixels
function getNodeAt(state, sx, sy) {
  if (!state || !state.nodes) return null;
  let best = null, bestDist = Infinity;
  const pickR = Math.max(8, ui.nodeSize + 6); // tolerância de clique (px)
  for (const n of state.nodes) {
    const nx = worldToScreenX(n.x);
    const ny = worldToScreenY(n.y);
    const d = Math.hypot(nx - sx, ny - sy);
    if (d < bestDist && d <= pickR) { best = n; bestDist = d; }
  }
  return best; // {id, x, y, type, ...} ou null
}

function getNeighbors(state, node, radiusWorld) {
  if (!state || !state.nodes || !node) return [];
  const out = [];
  for (const m of state.nodes) {
    if (m.id === node.id) continue;
    const d = Math.hypot(m.x - node.x, m.y - node.y);
    if (d <= radiusWorld) out.push(m);
  }
  return out;
}

function setText(id, val) {
  const e = document.getElementById(id);
  if (e) e.textContent = val;
}

function updateSelectedInfo(state) {
  const el = (id) => document.getElementById(id);
  if (!selectedNodeId || !state) {
    setText("sel-id", "—");
    setText("sel-type", "—");
    setText("sel-pos", "—");
    setText("sel-radius", "—");
    setText("sel-num-neigh", "—");
    setText("sel-neigh", "—");
    return;
  }
  const node = state.nodes.find(n => n.id === selectedNodeId);
  if (!node) { selectedNodeId = null; updateSelectedInfo(state); return; }
  const r = state.radius_comm || 0;
  const neigh = getNeighbors(state, node, r);

  setText("sel-id", String(node.id));
  setText("sel-type", (node.type || "REGULAR"));
  setText("sel-pos", `(${node.x.toFixed(1)}, ${node.y.toFixed(1)})`);
  setText("sel-radius", r.toFixed(2));
  setText("sel-num-neigh", `${neigh.length}`);
  setText("sel-neigh", `(${neigh.map(n => n.id).slice(0, 20).join(", ")}${neigh.length > 20 ? ", …" : ""})`);
}

function persistUI() {
  try { localStorage.setItem("wsn_ui", JSON.stringify(ui)); } catch (_) {}
}


// --- CSRF helpers (para POSTs) ---
function getCSRF() {
  const name = 'csrftoken';
  const cookie = document.cookie.split(';').map(v => v.trim());
  for (const c of cookie) {
    if (c.startsWith(name + '=')) return c.substring(name.length + 1);
  }
  return null;
}

function fetchJSON(url, opts = {}) {
  return fetch(url, opts).then(r => r.json());
}

// --- Upload com CSRF ---
document.getElementById("form-upload").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const res = await fetchJSON("/api/upload", {
    method: "POST",
    headers: { "X-CSRFToken": getCSRF() },
    body: fd,
  });
  if (!res.ok) alert(res.error || "Falha no upload");
  // após sucesso no upload:
  didInitialFit = false;
  selectedNodeId = null;
  updateSelectedInfo(lastState);
});

// --- Controles (play/pause/back/step/speed) com CSRF ---
document.querySelectorAll("button[data-act]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const act = btn.dataset.act;
    if (act === "speed") {
      const sp = document.getElementById("speed").value;
      await fetchJSON("/api/speed", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-CSRFToken": getCSRF(),
        },
        body: `speed=${encodeURIComponent(sp)}`,
      });
    } else {
      await fetchJSON(`/api/${act}`, {
        method: "POST",
        headers: { "X-CSRFToken": getCSRF() },
      });
    }
  });
});

// ======================
//   VIEWPORT / ZOOM/PAN
// ======================

function getWorldBoundsFromState(state) {
  // Se houver nós, usa o bbox real deles
  if (state && Array.isArray(state.nodes) && state.nodes.length > 0) {
    let minX = +Infinity, minY = +Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of state.nodes) {
      if (typeof n.x === "number" && typeof n.y === "number") {
        if (n.x < minX) minX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.x > maxX) maxX = n.x;
        if (n.y > maxY) maxY = n.y;
      }
    }
    if (isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
      return { minX, minY, maxX, maxY };
    }
  }
  // Fallback: usa state.dim (0..x, 0..y)
  const w = Math.max(1, state?.dim?.x || worldDim.x || 600);
  const h = Math.max(1, state?.dim?.y || worldDim.y || 600);
  return { minX: 0, minY: 0, maxX: w, maxY: h };
}

function canvasInternalSize() {
  // Garante usar o tamanho REAL do canvas (evita zoom errado por CSS)
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = Math.round(rect.width * dpr);
  const H = Math.round(rect.height * dpr);
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  return { W: canvas.width, H: canvas.height };
}

function fitToScreen(state = lastState) {
  if (!state) return;

  // Ajusta o canvas ao tamanho exibido (CSS) antes de calcular a escala
  const { W, H } = canvasInternalSize();

  const { minX, minY, maxX, maxY } = getWorldBoundsFromState(state);
  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);

  // Margem em unidades do mundo (5% do maior lado, mínimo 10)
  const pad = Math.max(10, 0.05 * Math.max(worldW, worldH));

  const sx = W / (worldW + pad * 2);
  const sy = H / (worldH + pad * 2);
  const scale = Math.min(sx, sy);

  view.scale = Math.max(view.minScale, Math.min(view.maxScale, scale));
  // Enquadra posicionando o canto superior-esquerdo na bbox com margem
  view.x = (minX - pad);
  view.y = (minY - pad);
}

function zoomAtScreenPoint(factor, sx, sy) {
  // fator > 1: zoom-in; fator < 1: zoom-out
  const oldScale = view.scale;
  let newScale = oldScale * factor;
  newScale = Math.max(view.minScale, Math.min(view.maxScale, newScale));
  const clampedFactor = newScale / oldScale;
  if (clampedFactor === 1) return;

  // mantém o ponto do mundo sob o cursor fixo na tela
  const wx = view.x + sx / oldScale;
  const wy = view.y + sy / oldScale;

  view.scale = newScale;
  view.x = wx - sx / newScale;
  view.y = wy - sy / newScale;
}

// Eventos de roda para zoom
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  const speed = 1.1; // sensibilidade
  const factor = e.deltaY < 0 ? speed : 1 / speed;
  zoomAtScreenPoint(factor, sx, sy);
}, { passive: false });

// Pan (arrastar com botão esquerdo)
let isDragging = false;
let lastMouse = { x: 0, y: 0 };

canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return; // só botão esquerdo
  isDragging = true;
  lastMouse.x = e.clientX;
  lastMouse.y = e.clientY;
});

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const dxPx = e.clientX - lastMouse.x;
  const dyPx = e.clientY - lastMouse.y;
  // converter deslocamento de px -> unidades de mundo
  view.x -= dxPx / view.scale;
  view.y -= dyPx / view.scale;
  lastMouse.x = e.clientX;
  lastMouse.y = e.clientY;
});

window.addEventListener("mouseup", () => {
  isDragging = false;
});

// ======================
//   DESENHO / TRANSFORM
// ======================

// Helpers de transformação
function worldToScreenX(wx) { return (wx - view.x) * view.scale; }
function worldToScreenY(wy) { return (wy - view.y) * view.scale; }

function drawConnectivity(state) {
  const nodes = state.nodes;
  const R = (state.radius_comm || 0);
  if (!R || R <= 0) return;

  ctx.save();
  ctx.strokeStyle = "rgba(40,40,40,0.8)";
  ctx.lineWidth = 1;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const ax = worldToScreenX(a.x), ay = worldToScreenY(a.y);
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      // distância no mundo (não em tela!)
      const dxW = a.x - b.x, dyW = a.y - b.y;
      const distW = Math.hypot(dxW, dyW);
      if (distW <= R) {
        const bx = worldToScreenX(b.x), by = worldToScreenY(b.y);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function drawPacket(state) {
  const p = state.packet;
  if (!p) return;

  const nodesById = new Map(state.nodes.map(n => [n.id, n]));
  const src = nodesById.get(p.source);
  if (!src) return;

  const SIZE = 6; // quadradinho na tela
  const phase = Math.max(0, Math.min(1, p.phase ?? 0));

  ctx.save();
  ctx.fillStyle = "#00F";

  const sx = worldToScreenX(src.x), sy = worldToScreenY(src.y);
  for (const did of p.dests) {
    const d = nodesById.get(did);
    if (!d) continue;
    const dx = worldToScreenX(d.x), dy = worldToScreenY(d.y);
    const x = sx * (1 - phase) + dx * phase;
    const y = sy * (1 - phase) + dy * phase;
    ctx.fillRect(Math.round(x - SIZE / 2), Math.round(y - SIZE / 2), SIZE, SIZE);
  }
  ctx.restore();
}

function drawPacketSquare(state) {
  const p = state.packet;
  if (!p) return;
  const nodesById = new Map(state.nodes.map(n => [n.id, n]));
  const src = nodesById.get(p.source);
  if (!src) return;

  const SIZE = 6;
  const phase = Math.max(0, Math.min(1, p.phase ?? 0));
  ctx.save();
  ctx.fillStyle = "#0d6efd";
  const sx = worldToScreenX(src.x), sy = worldToScreenY(src.y);
  for (const did of p.dests) {
    const d = nodesById.get(did);
    if (!d) continue;
    const dx = worldToScreenX(d.x), dy = worldToScreenY(d.y);
    const x = sx * (1 - phase) + dx * phase;
    const y = sy * (1 - phase) + dy * phase;
    ctx.fillRect(Math.round(x - SIZE/2), Math.round(y - SIZE/2), SIZE, SIZE);
  }
  ctx.restore();
}

function drawPacketWave(state) {
  const p = state.packet;
  if (!p) return;
  const nodesById = new Map(state.nodes.map(n => [n.id, n]));
  const src = nodesById.get(p.source);
  if (!src) return;

  // fase 0..1 -> raio 0..radius_comm (mundo)
  const phase = Math.max(0, Math.min(1, p.phase ?? 0));
  const rWorld = phase * (state.radius_comm || 0);
  const rPx = rWorld * view.scale;

  // centro na tela
  const cx = worldToScreenX(src.x);
  const cy = worldToScreenY(src.y);

  // círculo com alpha decrescente
  const alpha = Math.max(0.1, 1 - phase);
  ctx.save();
  ctx.strokeStyle = `rgba(13,110,253,${alpha})`; // #0d6efd com alpha
  ctx.lineWidth = Math.max(1, 2 * (1 - phase));

  ctx.beginPath();
  ctx.arc(cx, cy, rPx, 0, 2 * Math.PI);
  ctx.stroke();

  // (opcional) 2ª frente mais fraca, tipo “onda dupla”
  const r2 = Math.max(0, rPx - 0.25 * (state.radius_comm || 0) * view.scale);
  if (r2 > 2) {
    ctx.strokeStyle = `rgba(13,110,253,${alpha * 0.5})`;
    ctx.beginPath();
    ctx.arc(cx, cy, r2, 0, 2 * Math.PI);
    ctx.stroke();
  }
  ctx.restore();
}

function draw(state) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Grade leve (opcional)
  // drawGrid();

  // conectividade
  if (ui.showGraph) 
    drawConnectivity(state);

  if (ui.showTrails) 
    drawTrails(state);

  // --- Destaques da seleção (raio + vizinhos/arestas) ---
  if (selectedNodeId) {
    const node = state.nodes.find(n => n.id === selectedNodeId);
    if (node) {
      const rWorld = state.radius_comm || 0;
      const neigh = getNeighbors(state, node, rWorld);

      // raio (mundo -> tela)
      const cx = worldToScreenX(node.x);
      const cy = worldToScreenY(node.y);
      const rPx = rWorld * view.scale;

      // disco/anel de alcance
      ctx.save();
      ctx.strokeStyle = "rgba(220, 53, 69, 0.9)";   // vermelho Bootstrap
      ctx.fillStyle   = "rgba(220, 53, 69, 0.08)";
      ctx.lineWidth   = 2;
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, rPx), 0, 2*Math.PI); ctx.fill(); ctx.stroke();
      ctx.restore();

      // arestas do nó -> vizinhos
      ctx.save();
      ctx.strokeStyle = "rgba(25,135,84,0.9)";      // verde Bootstrap
      ctx.lineWidth = 2;
      for (const m of neigh) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(worldToScreenX(m.x), worldToScreenY(m.y));
        ctx.stroke();
      }
      ctx.restore();

      // contorno do nó selecionado
      ctx.save();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,193,7,0.9)"; // amarelo
      ctx.beginPath();
      ctx.arc(cx, cy, ui.showSprites ? Math.max(10, ui.nodeSize) : ui.nodeSize + 3, 0, 2*Math.PI);
      ctx.stroke();
      ctx.restore();
    }
  }

  // nós
  ctx.font = "12px sans-serif";
  state.nodes.forEach(n => {
    const x = worldToScreenX(n.x);
    const y = worldToScreenY(n.y);
    const key = (n.type || "REGULAR").toUpperCase();
    const img = sprites[key] || sprites.REGULAR;
    const size = ui.nodeSize * 2; // largura/altura em px na tela

    if (ui.showSprites && img && img.complete) {
      // desenha sprite centralizado
      if (key == "INTRUDER" || key == "UAV") {
        ctx.drawImage(img, Math.round(x - size), Math.round(y - size), 2 * size, 2 * size);
      }
      ctx.drawImage(img, Math.round(x - size/2), Math.round(y - size/2), size, size);
    } else {
      // fallback: bolinha
      ctx.beginPath();
      ctx.arc(x, y, ui.nodeSize, 0, 2 * Math.PI);
      ctx.fillStyle = n.color || "#FFA500";
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.stroke();
    }

    if (ui.showIds) {
      ctx.fillStyle = "#00A000";
      ctx.fillText(String(n.id), x + ui.nodeSize + 1, y - (ui.nodeSize + 1));
    }
  });

  // pacote (se houver)
  if (ui.packetStyle === "wave") {
    drawPacketWave(state);
  } else {
    drawPacketSquare(state);
  }
}

function resizeCanvasToDisplaySize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const displayWidth  = Math.round(rect.width  * dpr);
  const displayHeight = Math.round(rect.height * dpr);
  if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;
  }
}

async function poll() {
  try {
    // cache-buster simples
    const state = await fetchJSON('/api/state');

    // Atualiza dimensões declaradas (apenas informação; o fit usa bbox dos nós)
    if (state.dim) {
      worldDim = { x: state.dim.x || worldDim.x, y: state.dim.y || worldDim.y };
      radiusComm = state.radius_comm || radiusComm;
    }

    lastState = state;

    canvasInternalSize();

    // Fit automático apenas na primeira vez que recebemos estado com nós
    if (!didInitialFit && state.nodes && state.nodes.length > 0) {
      fitToScreen(state);
      didInitialFit = true;
    }

    draw(state);

    updateSelectedInfo(state);

    document.getElementById('info-time').textContent = `Tempo: ${state.time?.toFixed?.(2) ?? 0}`;
    document.getElementById('info-idx').textContent  = `Evento: ${state.idx}/${state.total ?? 0}`;
    if (state.meta) {
      const m = state.meta;
      const byId = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

      byId("meta-desc", m.description || "—");

      const fw = m.field?.width ?? null;
      const fh = m.field?.height ?? null;
      byId("meta-size", (fw && fh) ? `${fw} × ${fh}` : "—");

      byId("meta-nodes", (m.nodes_count ?? 0).toString());

      byId("meta-density", (typeof m.density === "number")
        ? (Number(m.density).toExponential(3))  // ex: 1.234e-4
        : "—");

      byId("meta-radius", (m.radius_comm ?? 0).toFixed(2));
      byId("meta-simtime", (m.simtime_max ?? 0).toFixed(2));
      byId("meta-events", (m.events_count ?? 0).toString());
    }

    if (state.mapping && state.mapping.legend) {
      renderLegend(state.mapping.legend);
    }

    if (state.stats) {
      const s = state.stats;
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set("stat-avgdeg", (s.avg_degree ?? 0).toFixed(2));
      set("stat-maxdeg", String(s.max_degree ?? 0));
      set("stat-comps",  String(s.components ?? 0));
      set("stat-pkts",   (s.packet_rate ?? 0).toFixed(3));
    }

  } catch (e) {
    // console.error(e);
  } finally {
    requestAnimationFrame(poll);
  }
}
requestAnimationFrame(poll);

// ======================
//   Botões de Zoom/Pan
// ======================
const btnFit = document.getElementById("btn-fit");
const btnZoomIn = document.getElementById("btn-zoomin");
const btnZoomOut = document.getElementById("btn-zoomout");
const chkIds = document.getElementById("chk-ids");
const chkGraph = document.getElementById("chk-graph");
const chkSprites = document.getElementById("chk-sprites");
const chkTrails = document.getElementById("chk-trails");

if (btnZoomIn) btnZoomIn.addEventListener("click", (e) => {
  e.preventDefault();
  zoomAtScreenPoint(1.2, canvas.width / 2, canvas.height / 2);
  if (lastState) 
    draw(lastState);
});

if (btnZoomOut) btnZoomOut.addEventListener("click", (e) => {
  e.preventDefault();
  zoomAtScreenPoint(1/1.2, canvas.width / 2, canvas.height / 2);
  if (lastState) 
    draw(lastState);
});

if (btnFit) btnFit.addEventListener("click", (e) => {
  e.preventDefault();
  fitToScreen();
  if (lastState) 
    draw(lastState);
});

if (chkIds) {
  chkIds.checked = !!ui.showIds;
  chkIds.addEventListener("change", () => {
    ui.showIds = chkIds.checked;
    persistUI();
    if (lastState) 
      draw(lastState);
  });
}

if (chkGraph) {
  // aplica o estado salvo ao carregar
  chkGraph.checked = !!ui.showGraph;
  chkGraph.addEventListener("change", () => {
    ui.showGraph = chkGraph.checked;
    persistUI();
    if (lastState) 
      draw(lastState);
  });
}

if (chkSprites) {
  chkSprites.checked = !!ui.showSprites;          // aplica estado salvo
  chkSprites.addEventListener("change", () => {
    ui.showSprites = chkSprites.checked;
    persistUI();
    if (lastState)
      draw(lastState);               // redesenha na hora
  });
}

if (chkTrails) {
  chkTrails.checked = !!ui.showTrails;   // aplica estado salvo
  chkTrails.addEventListener("change", () => {
    ui.showTrails = chkTrails.checked;
    persistUI();
    if (lastState) 
      draw(lastState);
  });
}

// ----- Botões: tamanho dos nós -----
const btnNodeInc = document.getElementById("btn-node-inc");
const btnNodeDec = document.getElementById("btn-node-dec");
const btnNodeReset = document.getElementById("btn-node-reset");

if (btnNodeInc) btnNodeInc.addEventListener("click", (e) => {
  e.preventDefault();
  ui.nodeSize = Math.min(ui.maxNodeSize, ui.nodeSize + 1);
  persistUI();
  if (lastState) draw(lastState);
});
if (btnNodeDec) btnNodeDec.addEventListener("click", (e) => {
  e.preventDefault();
  ui.nodeSize = Math.max(ui.minNodeSize, ui.nodeSize - 1);
  persistUI();
  if (lastState) draw(lastState);
});
if (btnNodeReset) btnNodeReset.addEventListener("click", (e) => {
  e.preventDefault();
  ui.nodeSize = 6;
  persistUI();
  if (lastState) draw(lastState);
});

const btnAnimPacket = document.getElementById("btn-anim-packet");
const btnAnimWave   = document.getElementById("btn-anim-wave");

function setAnimStyle(style) {
  ui.packetStyle = style; persistUI();
  if (btnAnimPacket && btnAnimWave) {
    const isWave = style === "wave";
    btnAnimWave.classList.toggle("active", isWave);
    btnAnimPacket.classList.toggle("active", !isWave);
    btnAnimWave.setAttribute("aria-pressed", String(isWave));
    btnAnimPacket.setAttribute("aria-pressed", String(!isWave));
  }
  if (lastState) draw(lastState);
}

// aplica estado salvo
setAnimStyle(ui.packetStyle || "wave");

if (btnAnimPacket) btnAnimPacket.addEventListener("click", (e) => {
  e.preventDefault(); setAnimStyle("packet");
});
if (btnAnimWave) btnAnimWave.addEventListener("click", (e) => {
  e.preventDefault(); setAnimStyle("wave");
});

// ----- Salvar PNG -----
const btnSavePng = document.getElementById("btn-save-png");

if (btnSavePng) {
  btnSavePng.addEventListener("click", (e) => {
    e.preventDefault();

    // Se quiser fundo branco no PNG:
    const tmp = document.createElement("canvas");
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    const tctx = tmp.getContext("2d", { willReadFrequently: true });
    tctx.fillStyle = "#fff";
    tctx.fillRect(0, 0, tmp.width, tmp.height);
    tctx.drawImage(canvas, 0, 0);

    const dataURL = tmp.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataURL;
    a.download = `simulacao-rssf-${new Date().toISOString().replace(/[:.]/g,"-")}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

// Clique: selecionar nó
canvas.addEventListener("click", (e) => {
  if (!lastState) return;
  const { sx, sy } = getCanvasMouse(e);
  const node = getNodeAt(lastState, sx, sy);
  selectedNodeId = node ? node.id : null;
  updateSelectedInfo(lastState);
  draw(lastState);
});

// Limpar seleção por botão
const btnClearSel = document.getElementById("btn-clear-selection");
if (btnClearSel) btnClearSel.addEventListener("click", () => {
  selectedNodeId = null;
  updateSelectedInfo(lastState);
  if (lastState) draw(lastState);
});

// Limpar seleção com Esc
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    selectedNodeId = null;
    updateSelectedInfo(lastState);
    if (lastState) draw(lastState);
  }
});

const btnCloseSim = document.getElementById("btn-close-sim");

if (btnCloseSim) {
  btnCloseSim.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/close", {
        method: "POST",
        headers: { "X-CSRFToken": getCSRF() },
      }).then(r => r.json());

      // Limpa UI local
      selectedNodeId = null;
      lastState = { nodes: [], time: 0, idx: 0, total: 0, radius_comm: 0, dim: {x:0,y:0} };
      didInitialFit = false;

      // limpa infos de meta/painel
      const clearText = (id) => { const el = document.getElementById(id); if (el) el.textContent = "—"; };
      clearText("meta-desc");
      clearText("meta-size");
      clearText("meta-nodes");
      clearText("meta-density");
      clearText("meta-radius");
      clearText("meta-simtime");
      clearText("meta-events");
      clearText("sel-id");
      clearText("sel-type");
      clearText("sel-pos");
      clearText("sel-radius");
      clearText("sel-num-neigh");
      clearText("sel-neigh");

      // limpa canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    } catch (_) {}
  });
}

const selMapping = document.getElementById("sel-mapping");
const legendEl   = document.getElementById("legend");

async function loadMappings() {
  try {
    const res = await fetchJSON(`/api/mapping/list?ts=${Date.now()}`);
    if (!res.ok) return;
    // preencher select
    if (selMapping) {
      selMapping.innerHTML = "";
      for (const it of res.mappings) {
        const opt = document.createElement("option");
        opt.value = it.key;
        opt.textContent = it.label;
        if (it.key === res.current) {
          opt.selected = true;
        }
        selMapping.appendChild(opt);
      }
    }
  } catch(_) {}
}

if (selMapping) {
  loadMappings();
  selMapping.addEventListener("change", async () => {
    const key = selMapping.value;
    await fetch(`/api/mapping/set`, {
      method: "POST",
      headers: {
        "Content-Type":"application/x-www-form-urlencoded",
        "X-CSRFToken": getCSRF(),
      },
      body: `key=${encodeURIComponent(key)}`
    }).catch(()=>{});
    // força um redesenho com próximo /api/state
  });
}

function renderLegend(legend) {
  if (!legendEl || !legend) 
    return;
  if (legend.type === "categorical") {
    legendEl.innerHTML =
      `<div><strong>${legend.title}:</strong> ` +
      legend.items.map(it =>
        `<span class="badge me-1" style="background:${it.color}; color:#fff">${it.label}</span>`
      ).join(" ") + `</div>`;
  } else if (legend.type === "continuous") {
    const [c1, c2] = legend.colors || ["#cce", "#99f"];
    legendEl.innerHTML =
      `<div><strong>${legend.title}:</strong>
        <span class="me-2">${legend.from||""}</span>
        <span style="display:inline-block;width:160px;height:10px;border-radius:8px;
          background: linear-gradient(90deg, ${c1}, ${c2}); vertical-align:middle;"></span>
        <span class="ms-2">${legend.to||""}</span>
      </div>`;
  } else if (legend.type === "note") {
    legendEl.innerHTML = `<div><strong>${legend.title}:</strong> ${legend.note||""}</div>`;
  } else {
    legendEl.innerHTML = "";
  }
}

function drawTrails(state) {
  if (!ui.showTrails) 
    return;
  const nodes = state.nodes || [];
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const n of nodes) {
    // opcional: desenhar trilha só dos móveis
    if (!n.mobile)
      continue;

    const tr = n.track;
    if (!tr || tr.length < 2) 
      continue;

    // amostra leve: ignora pontos muito próximos (em px) pra não pesar
    const screenPts = [];
    let lastSX = null, lastSY = null;
    for (const p of tr) {
      const sx = worldToScreenX(p.x);
      const sy = worldToScreenY(p.y);
      if (lastSX == null || Math.hypot(sx - lastSX, sy - lastSY) >= ui.trailMinScreenStep) {
        screenPts.push([sx, sy]);
        lastSX = sx; lastSY = sy;
      }
    }
    if (screenPts.length < 2) continue;

    // degradê simples de alpha do mais antigo (fraco) para o mais recente (forte)
    if (ui.trailFade) {
      for (let i = 1; i < screenPts.length; i++) {
        const a = screenPts[i-1], b = screenPts[i];
        const t = i / (screenPts.length - 1);  // 0..1
        const alpha = Math.max(0.05, ui.trailAlpha * t);
        if (!n.type || n.type.toUpperCase() === "INTRUDER")
          ctx.strokeStyle = `rgba(255,10,10,${alpha})`; // tom vermelho
        else
          ctx.strokeStyle = `rgba(13,110,253,${alpha})`; // tom azul Bootstrap
        ctx.lineWidth = ui.trailWidth;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
    } else {
      if (!n.type || n.type.toUpperCase() === "INTRUDER")
        ctx.strokeStyle = `rgba(255,10,10,${ui.trailAlpha})`;  // tom vermelho
      else  
        ctx.strokeStyle = `rgba(13,110,253,${ui.trailAlpha})`;  // tom azul Bootstrap
      ctx.lineWidth = ui.trailWidth;
      ctx.beginPath();
      ctx.moveTo(screenPts[0][0], screenPts[0][1]);
      for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i][0], screenPts[i][1]);
      ctx.stroke();
    }
  }

  ctx.restore();
}



