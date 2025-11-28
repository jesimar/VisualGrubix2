from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Optional
import math

# ==============================================================
# CLASSE BASE: POSITION (equivalente a Position.java)
# ==============================================================
@dataclass
class Position:
    x: float
    y: float
    def distance_to(self, other:'Position')->float:
        """Calcula a distância euclidiana entre dois pontos."""
        return math.sqrt((self.x - other.x) ** 2 + (self.y - other.y) ** 2)

# ==============================================================
# NODE (equivalente a Node.java / NodeGeneric.java)
# ==============================================================
@dataclass
class Node:
    node_id: int
    x: float
    y: float
    radius_comm: float
    node_type_str: str='REGULAR' # REGULAR | UAV | INTRUDER
    is_mobile: bool=False
    color_rgb: tuple[int,int,int]=(255,165,0)
    border_color_rgb: tuple[int,int,int]=(255,165,0)
    label: str=''
    track: List[Position]=field(default_factory=list)

    def position(self)->Position: 
        return Position(self.x,self.y)
    
    def move_to(self, nx: float, ny: float)->None:
        """Move o nó para uma nova posição."""
        self.x = nx
        self.y = ny
        self.track.append(Position(nx,ny))
    
    def distance_to(self, other: "Node") -> float:
        """Distância até outro nó."""
        return math.sqrt((self.x - other.x) ** 2 + (self.y - other.y) ** 2)

# ==============================================================
# STATE (equivalente a State.java)
# ==============================================================
@dataclass
class State:
    id_event: int
    receiver_id: int    # -1 => broadcast
    sender_id: int
    intern_receiver_id: int
    time: float

# ==============================================================
# MOVE (equivalente a Move.java)
# ==============================================================
@dataclass
class Move:
    node: 'Node'
    time: float
    x: float
    y: float
    
    def apply(self)->None: 
        self.node.move_to(self.x, self.y)

# ==============================================================
# EVENTGENERIC (equivalente a EventGeneric.java)
# ==============================================================
@dataclass
class EventGeneric:
    time: float
    def run(self)->None: 
        raise NotImplementedError

# ==============================================================
# EVENTMOVE (equivalente a EventMove.java)
# ==============================================================
@dataclass
class EventMove(EventGeneric):
    moves: List[Move]=field(default_factory=list)

    def run(self)->None:
        for mv in self.moves:
            mv.apply()

# ==============================================================
# EVENTMSG (equivalente a EventMsg.java)
# ==============================================================
@dataclass
class EventMsg(EventGeneric):
    source: 'Node'
    destinations: List['Node']
    amount_packet: int
    def run(self)->None: 
        pass
        """Executa um envio de pacote entre nós."""
        '''
        for dest in self.destinations:
            # apenas uma simulação lógica, pode ser expandida depois
            distance = self.source.distance_to(dest)
            if distance <= self.source.radius:
                print(f"Pacote {self.packet_id} enviado de {self.source.node_id} → {dest.node_id} ({distance:.2f}m)")
        '''
# ==============================================================
# DATA SIMULATION (parcial de DataSimulation.java)
# ==============================================================
@dataclass
class DataSimulation:
    dimension_x: int=0
    dimension_y: int=0
    time_simulation_max: float=0.0
    radius_communication: float=0.0
    description: str=''
    nodes: List[Node]=field(default_factory=list)
    events: List[EventGeneric]=field(default_factory=list)
    moves: List[Move]=field(default_factory=list)
    times_move: List[float]=field(default_factory=list)
    
    def add_node(self, node:Node)->None: 
        self.nodes.append(node)
    
    def get_node(self, node_id: int) -> Optional[Node]:
        return next((n for n in self.nodes if n.node_id==node_id), None)
    
    def add_event(self, ev: EventGeneric) -> None: 
        self.events.append(ev)
    
    def add_move(self, mv: Move) -> None: 
        self.moves.append(mv)
    
    def add_time_move(self, t: float) -> None:
        if not self.times_move or self.times_move[-1]!=t: 
            self.times_move.append(t)
