# simulation/mapping.py
from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Tuple
import math
import hashlib

Color = Tuple[int, int, int]  # RGB 0..255

# Paletas acessíveis (colorblind-friendly) e tons azuis
PALETTE_TYPE: Dict[str, Color] = {
    "REGULAR": (255, 165,   0),  # laranja (coerente com legado)
    "UAV"    : ( 63, 140, 255),  # azul vivo
    "INTRUDER":(220,  53,  69),  # vermelho bootstrap
}
PALETTE_BLUE: List[Color] = [
    (227,242,253),(187,222,251),(144,202,249),(100,181,246),
    ( 66,165,245),( 33,150,243),( 30,136,229),( 25,118,210),
    ( 21,101,192),( 13, 71,161),
]
PALETTE_CAT10: List[Color] = [
    ( 31,119,180),(255,127, 14),( 44,160, 44),(214, 39, 40),(148,103,189),
    (140, 86, 75),(227,119,194),(127,127,127),(188,189, 34),( 23,190,207)
]

def _clamp(v: float, a: float, b: float) -> float:
    return max(a, min(b, v))

def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t

def _rgb_to_hex(c: Color) -> str:
    r,g,b = c
    return f"#{r:02x}{g:02x}{b:02x}"

def _interp_palette(pal: List[Color], t: float) -> Color:
    """Interpolação linear sobre uma paleta ordenada (t=0..1)."""
    if not pal: return (200,200,200)
    if len(pal) == 1: return pal[0]
    t = _clamp(t, 0.0, 1.0) * (len(pal)-1)
    i = int(math.floor(t))
    j = min(i+1, len(pal)-1)
    frac = t - i
    a, b = pal[i], pal[j]
    return (int(_lerp(a[0], b[0], frac)),
            int(_lerp(a[1], b[1], frac)),
            int(_lerp(a[2], b[2], frac)))

# ========= “Abstract” =========
class ColorMapping:
    key: str = "abstract"
    label: str = "Abstract"
    def color_of(self, node, nodes, meta) -> Color:  # override
        return (200, 200, 200)
    def legend(self, nodes, meta) -> Dict:
        return {"type": "none", "title": self.label}

# ========= Por Tipo =========
class MappingByType(ColorMapping):
    key = "by_type"
    label = "Por tipo de nó"
    def color_of(self, node, nodes, meta) -> Color:
        return PALETTE_TYPE.get((node.node_type_str or "REGULAR").upper(), (255, 165, 0))
    def legend(self, nodes, meta) -> Dict:
        items = [{"label": k.title(), "color":_rgb_to_hex(v)} for k,v in PALETTE_TYPE.items()]
        return {"type": "categorical", "title": self.label, "items": items}

# ========= Por ID (hash estável) =========
class MappingById(ColorMapping):
    key = "by_id"
    label = "Por ID (hash)"
    def color_of(self, node, nodes, meta) -> Color:
        h = hashlib.md5(str(node.node_id).encode()).digest()[0] / 255.0
        return _interp_palette(PALETTE_CAT10, h)
    def legend(self, nodes, meta) -> Dict:
        return {"type": "note", "title": self.label, "note": "Cor estável baseada no ID."}

# ========= Por Grau de Conectividade =========
class MappingByDegree(ColorMapping):
    key = "by_degree"
    label = "Por grau (nº de vizinhos)"
    def color_of(self, node, nodes, meta) -> Color:
        # precisa de radius_comm em meta
        R = float(meta.get("radius_comm", 0.0) or 0.0)
        if R <= 0 or not nodes: 
            return (180,180,180)
        deg = 0
        for m in nodes:
            if m.node_id == node.node_id: 
                continue
            dx = m.x - node.x
            dy = m.y - node.y
            if math.hypot(dx, dy) <= R: 
                deg += 1
        # normaliza pelo máx. grau
        max_deg = meta.get("_degree_max", 1) or 1
        t = deg / max_deg
        return _interp_palette(PALETTE_BLUE, t)
    def legend(self, nodes, meta) -> Dict:
        # escala contínua
        return {"type": "continuous", "title": self.label,
                "from": "grau baixo", "to": "grau alto",
                "colors":[_rgb_to_hex(PALETTE_BLUE[0]), _rgb_to_hex(PALETTE_BLUE[-1])]}

# Registro
MAPPINGS: Dict[str, ColorMapping] = {
    MappingByType.key:   MappingByType(),
    MappingById.key:     MappingById(),
    MappingByDegree.key: MappingByDegree(),
}

DEFAULT_MAPPING_KEY = MappingByType.key
