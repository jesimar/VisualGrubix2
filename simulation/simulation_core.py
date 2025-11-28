from __future__ import annotations
import time, math
from dataclasses import dataclass, field
from typing import Optional, Literal, Dict, List, Tuple, Set
from .models import DataSimulation, EventGeneric, EventMove, EventMsg
from .mapping import MAPPINGS, DEFAULT_MAPPING_KEY, _rgb_to_hex

Mode = Literal["PLAY", "PAUSE", "BACK"]
ANIM_MSG_DURATION = 0.8  # segundos
TRACK_MAX = 80

@dataclass
class SimulationController:
    data:Optional[DataSimulation]=None
    mode:Mode="PAUSE"
    idx:int=0
    speed:float=1.0                  # 1.0 = normal; menor = mais rápido (aprox.)
    last_tick:float=field(default_factory=time.time)
    time_sim:float=0.0
    anim_phase:float=0.0             # 0..1 para animar pacotes
    mapping_key: str = DEFAULT_MAPPING_KEY

    events_total: int = 0
    moves_applied: int = 0
    msgs_started: int = 0
    msgs_completed: int = 0

    _stats_cache: Dict = field(default_factory=dict)
    _stats_last_wall: float = field(default_factory=lambda: 0.0)
    _stats_throttle_sec: float = 0.5  # recalcular no máx. 2x/s

    def init(self, data:DataSimulation)->None:
        self.data=data
        self.mode="PAUSE"
        self.idx=0
        self.speed=1.0
        self.time_sim=0.0
        self.last_tick=time.time()
        self.anim_phase=0.0
        # reset stats
        self.events_total = len(data.events)
        self.moves_applied = 0
        self.msgs_started = 0
        self.msgs_completed = 0
        self._stats_cache = {}
        self._stats_last_wall = 0.0

    def play(self)->None: 
        self.mode="PLAY"
    
    def pause(self)->None: 
        self.mode="PAUSE"
    
    def back(self)->None: 
        self.mode="BACK"

    def step_forward(self) -> None:
        if not self.data:
            return
        ev = self.data.events[self.idx]
        self.time_sim = ev.time
        if self.idx + 1 < len(self.data.events):
            self.idx += 1
            self.anim_phase = 0.0
            # se for EventMsg, a animação começará do 0.0 normalmente
        else:
            # já estamos no último
            self.idx = len(self.data.events) - 1
            self.mode = "PAUSE"
            # se o último for EventMsg e você quiser “congelar” a onda completa manualmente:
            last = self._current_event()
            if isinstance(last, EventMsg):
                self.anim_phase = 1.0
            else:
                self.anim_phase = 0.0

    def step_back(self)->None:
        if not self.data: 
            return
        self.idx = max(self.idx - 1, 0)
        self.anim_phase = 0.0

    def _current_event(self):
        if not self.data or not self.data.events: 
            return None
        i = max(0, min(self.idx, len(self.data.events)-1))
        return self.data.events[i]
    
    # ----------------- Estatísticas rápidas -----------------
    def _compute_stats(self) -> Dict:
        """Computa grau médio/máximo, histograma de graus e componentes."""
        if not self.data or not self.data.nodes:
            return {
                "nodes": 0, "avg_degree": 0.0, "max_degree": 0,
                "degree_hist": [], "components": 0,
                "msgs_started": self.msgs_started,
                "msgs_completed": self.msgs_completed,
                "packet_rate": 0.0,  # simples (com base no tempo simulado)
            }

        nodes = self.data.nodes
        R = float(self.data.radius_communication or 0.0)
        if R <= 0.0:
            # sem raio, graus = 0 e cada nó vira um componente
            n = len(nodes)
            return {
                "nodes": n, "avg_degree": 0.0, "max_degree": 0,
                "degree_hist": [(0, n)], "components": n,
                "msgs_started": self.msgs_started,
                "msgs_completed": self.msgs_completed,
                "packet_rate": (self.msgs_completed / max(self.time_sim, 1e-9)),
            }

        # ----- Grade espacial para vizinhança O(n) -----
        cell = max(R, 1.0)
        buckets: Dict[Tuple[int,int], List[int]] = {}
        xs = [n.x for n in nodes]; ys = [n.y for n in nodes]
        for idx, n in enumerate(nodes):
            ix = int(math.floor(n.x / cell))
            iy = int(math.floor(n.y / cell))
            buckets.setdefault((ix, iy), []).append(idx)

        def neighbors(idx: int) -> List[int]:
            n = nodes[idx]
            ix = int(math.floor(n.x / cell))
            iy = int(math.floor(n.y / cell))
            out: List[int] = []
            for dx in (-1,0,1):
                for dy in (-1,0,1):
                    key = (ix+dx, iy+dy)
                    if key not in buckets: continue
                    for j in buckets[key]:
                        if j == idx: continue
                        m = nodes[j]
                        if (n.x-m.x)**2 + (n.y-m.y)**2 <= R*R:
                            out.append(j)
            return out

        # Graus
        degs: List[int] = []
        nbrs_cache: List[List[int]] = []
        for i in range(len(nodes)):
            nb = neighbors(i)
            nbrs_cache.append(nb)
            degs.append(len(nb))

        n = len(nodes)
        avg_deg = sum(degs) / n
        max_deg = max(degs) if degs else 0

        # Histograma de graus (0..max_deg)
        hist: List[Tuple[int,int]] = []
        if max_deg <= 12:
            # bins exatos de 0..max_deg
            for k in range(max_deg+1):
                hist.append((k, sum(1 for d in degs if d == k)))
        else:
            # binning grosso (ex.: 12 bins)
            bins = 12
            step = max(1, math.ceil(max_deg / bins))
            k = 0
            while k <= max_deg:
                cnt = sum(1 for d in degs if k <= d < k+step)
                hist.append((k, cnt))
                k += step

        # Componentes (BFS usando vizinhos da cache)
        seen: Set[int] = set()
        comps = 0
        for i in range(n):
            if i in seen: continue
            comps += 1
            stack = [i]
            seen.add(i)
            while stack:
                u = stack.pop()
                for v in nbrs_cache[u]:
                    if v not in seen:
                        seen.add(v)
                        stack.append(v)

        # taxa de pacotes concluídos por unidade de tempo simulado
        pkt_rate = (self.msgs_completed / max(self.time_sim, 1e-9))

        return {
            "nodes": n,
            "avg_degree": avg_deg,
            "max_degree": max_deg,
            "degree_hist": hist,     # lista de (grau/bin_inicial, contagem)
            "components": comps,
            "msgs_started": self.msgs_started,
            "msgs_completed": self.msgs_completed,
            "packet_rate": pkt_rate,
        }
    
    def tick(self) -> None:
        if not self.data:
            return

        now = time.time()
        elapsed = now - self.last_tick
        self.last_tick = now

        if self.mode not in ("PLAY", "BACK"):
            return

        speed_div = max(self.speed, 0.05)

        if self.mode == "BACK":
            # relógio para trás e steps ocasionais (como você já fazia)
            self.time_sim = max(0.0, self.time_sim - elapsed / speed_div)
            if elapsed > 0.2 / speed_div:
                self.step_back()
            return

        # PLAY: avança o relógio simulado
        self.time_sim += elapsed / speed_div

        # --------- ESTE É O PONTO-CHAVE: processar EventMove ---------
        ev = self._current_event()
        if ev is None:
            self.mode = "PAUSE"
            self.idx = 0
            self.anim_phase = 0.0
            return

        # Consome em sequência todos os EventMove (aplica e avança)
        while isinstance(ev, EventMove):
            # aplique os movimentos desse evento (usa sua API real)
            ev.run()  # dentro dele já faz mv.apply() para cada Move(x,y)
            self.moves_applied += len(ev.moves)
            # avança para o próximo evento (ou pausa no fim)
            if self.idx + 1 < len(self.data.events):
                self.idx += 1
                ev = self._current_event()
                continue
            else:
                self.mode = "PAUSE"
                return
        # --------------------------------------------------------------

        # A partir daqui, se não era EventMove, tratamos EventMsg (animação)
        if isinstance(ev, EventMsg):
            # contou início (apenas na primeira vez da animação)
            if self.anim_phase == 0.0:
                self.msgs_started += 1
            self.anim_phase += elapsed / speed_div / ANIM_MSG_DURATION
            if self.anim_phase >= 1.0:
                if self.idx + 1 < len(self.data.events):
                    self.idx += 1
                    self.anim_phase = 0.0
                else:
                    self.anim_phase = 1.0
                    self.mode = "PAUSE"
        # Outros tipos (se existirem) ficam parados até próximo tick ou step

        # Atualiza cache de stats com throttle
        if (now - self._stats_last_wall) >= self._stats_throttle_sec:
            self._stats_cache = self._compute_stats()
            self._stats_last_wall = now

    def set_mapping(self, key: str) -> None:
        if key in MAPPINGS:
            self.mapping_key = key

    def snapshot(self) -> dict:
        if not self.data:
            return {"nodes": [], "mode": self.mode, "idx": 0, "time": 0.0}
        
        # acrescente um pré-cálculo: grau máximo (para MappingByDegree)
        R = float(self.data.radius_communication or 0.0)
        degree_max = 1
        if R > 0 and self.data.nodes:
            degs = []
            for a in self.data.nodes:
                d = 0
                for b in self.data.nodes:
                    if b.node_id == a.node_id: 
                        continue
                    if ((a.x-b.x)**2 + (a.y-b.y)**2) ** 0.5 <= R:
                        d += 1
                degs.append(d)
            degree_max = max(1, max(degs))

        # --- Metadados ---
        w = int(self.data.dimension_x or 0)
        h = int(self.data.dimension_y or 0)
        area = float(w * h) if (w > 0 and h > 0) else None
        nodes_count = len(self.data.nodes)

        # bbox real dos nós
        if nodes_count:
            xs = [n.x for n in self.data.nodes]
            ys = [n.y for n in self.data.nodes]
            minx, maxx = min(xs), max(xs)
            miny, maxy = min(ys), max(ys)
            bbox_w = max(1.0, maxx - minx)
            bbox_h = max(1.0, maxy - miny)
        else:
            minx = miny = 0.0
            bbox_w = float(w or 1)
            bbox_h = float(h or 1)

        density = (nodes_count / area) if area else None

        meta = {
            "description": self.data.description or "",
            "field": {"width": w, "height": h, "area": area},
            "bbox": {"minX": minx, "minY": miny, "width": bbox_w, "height": bbox_h},
            "nodes_count": nodes_count,
            "events_count": len(self.data.events),
            "radius_comm": float(self.data.radius_communication or 0.0),
            "simtime_max": float(self.data.time_simulation_max or 0.0),
            "density": density,
            "_degree_max": degree_max,  # <-- para o mapping
        }

        # === cores por nó ===
        mapper = MAPPINGS.get(self.mapping_key)
        # usamos os objetos Node vivos (self.data.nodes)
        nodes_out = []
        for n in self.data.nodes:
            rgb = mapper.color_of(n, self.data.nodes, meta) if mapper else (200, 200, 200)
            # Trilhas somente para UAV/INTRUDER
            tp = (n.node_type_str or "REGULAR").upper()
            if tp in ("UAV", "INTRUDER") and n.track:
                track_slice = n.track[-TRACK_MAX:]
                track_out = [{"x": p.x, "y": p.y} for p in track_slice]
            else:
                track_out = []
                
            nodes_out.append({
                "id": n.node_id, 
                "x": n.x, 
                "y": n.y,
                "type": n.node_type_str, 
                "mobile": n.is_mobile,
                "label": n.label,
                "color": _rgb_to_hex(rgb),
                "track": track_out,
            })

        total = len(self.data.events)

        packet = None
        ev = self._current_event()
        if isinstance(ev, EventMsg) and self.mode == "PLAY":
            packet = {
                "source": ev.source.node_id,
                "dests": [d.node_id for d in ev.destinations],
                "phase": self.anim_phase,  # 1.0 quando pausado no fim
            }
        # legenda do mapping atual
        legend = mapper.legend(self.data.nodes, meta) if mapper else {"type": "none", "title": "Cores"}
        stats = self._stats_cache or self._compute_stats()
        return {
            "nodes": nodes_out,
            "mode": self.mode,
            "idx": self.idx,
            "total": total,
            "time": self.time_sim,
            "speed": self.speed,
            "dim": {"x": self.data.dimension_x, "y": self.data.dimension_y},
            "radius_comm": self.data.radius_communication,
            "packet": packet,
            "meta": meta,
            "mapping": {"key": self.mapping_key, "legend": legend},
            "stats": stats,
        }

    def close(self):
        self.data = None
        self.idx = 0
        self.time_sim = 0.0
        self.speed = 1.0
        self.mode = "PAUSE"
        self.anim_phase = 0.0
        self.last_tick = time.time()
        self.events_total = 0
        self.moves_applied = 0
        self.msgs_started = 0
        self.msgs_completed = 0
        self._stats_cache = {}
        self._stats_last_wall = 0.0