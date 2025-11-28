from __future__ import annotations
from xml.etree import ElementTree as ET
from typing import List
from .models import DataSimulation, Node, State, EventMsg, EventMove, Move

class XMLReader:
    def read_dom(self, file_path:str)->DataSimulation:
        tree = ET.parse(file_path)
        root = tree.getroot()
        data = DataSimulation()
        self._read_configuration(root,data)
        states: List[State]=[]
        self._read_simulation_run(root,data,states)
        self._create_list_events(data,states)
        self._create_list_events_moves(data)
        return data

    def iter_sax_like(self, file_path:str)->DataSimulation:
        """
        Leitura tipo SAX usando iterparse — equivalente conceitual ao ReaderLogXmlSAX.
        Útil para arquivos grandes.
        """
        return self.read_dom(file_path)

    def _read_configuration(self, root:ET.Element, data:DataSimulation)->None:
        cfg = root.find('configuration'); 
        if cfg is None: return
        field = cfg.find('field')
        if field is not None:
            data.dimension_x = int(float(field.findtext('x','0')))
            data.dimension_y = int(float(field.findtext('y','0')))
        data.time_simulation_max = float(cfg.findtext('simulationtime','0.0'))
        data.radius_communication = 10.0*float(cfg.findtext('communicationradius','0.0'))
        desc = cfg.find('description')
        if desc is not None and 'write' in desc.attrib: data.description = desc.attrib['write']
        pos_list = cfg.find('positions')
        if pos_list is not None:
            for pos in pos_list.findall('position'):
                node_id = int(pos.findtext('id'))
                x = 10.0*float(pos.findtext('x')); y = 10.0*float(pos.findtext('y'))
                info = pos.find('info'); node_type = info.attrib.get('nodetype','REGULAR') if info is not None else 'REGULAR'
                is_mobile = pos.findtext('ismobile','false').lower()=='true'
                data.add_node(Node(node_id,x,y,data.radius_communication,node_type,is_mobile))

    def _read_simulation_run(self, root:ET.Element, data:DataSimulation, out_states:List[State])->None:
        simrun = root.find('simulationrun')
        if simrun is None: return
        for tag in list(simrun):
            name = tag.tag.lower()
            if name=='enqueue':
                tolayer = tag.find('tolayer')
                sender_layer = tolayer.findtext('senderlayer','') if tolayer is not None else ''
                if sender_layer.lower()=='physical':
                    time = float(tag.findtext('time','0.0'))
                    id_event = int(tag.findtext('id','0'))
                    receiver_id = int(tag.findtext('receiverid','0'))
                    sender_id = int(tolayer.findtext('senderid','0'))
                    intern_receiver_id = int(tolayer.findtext('internreceiverid','0'))
                    out_states.append(State(id_event,receiver_id,sender_id,intern_receiver_id,time))
            elif name=='nodestate':
                pass
            elif name=='move':
                node_id = int(tag.attrib.get('id'))
                x = 10.0*float(tag.attrib.get('x')); y = 10.0*float(tag.attrib.get('y'))
                t = float(tag.attrib.get('time'))
                node = data.get_node(node_id)
                if node:
                    mv = Move(node=node,time=t,x=x,y=y)
                    data.add_move(mv); data.add_time_move(t)

    def _create_list_events(self, data:DataSimulation, states:List[State])->None:
        if not states: return
        states_sorted = sorted(states, key=lambda s:(s.time,s.id_event))
        i=0; amount_packet=0
        while i < len(states_sorted):
            curr = states_sorted[i]; same=[curr]; j=i+1
            while j < len(states_sorted) and states_sorted[j].id_event==curr.id_event:
                same.append(states_sorted[j]); j+=1
            amount_packet += 1
            dests = []
            if curr.receiver_id == -1:
                for s in same:
                    n = data.get_node(s.intern_receiver_id)
                    if n: dests.append(n)
            else:
                n = data.get_node(curr.receiver_id)
                if n: dests.append(n)
            src = data.get_node(curr.sender_id)
            if src:
                data.add_event(EventMsg(time=curr.time, source=src, destinations=dests, amount_packet=amount_packet))
            i = j

    def _create_list_events_moves(self, data:DataSimulation)->None:
        """
        Insere EventMove nos pontos de tempo de movimentos,
        respeitando a ordem temporal (como no Java). 
        """
        for t in sorted(set(data.times_move)):
            moves_at_t = [mv for mv in data.moves if mv.time == t]
            if not moves_at_t: 
                continue
            ev = EventMove(time=t, moves=moves_at_t) 
            inserted=False
            for idx, e in enumerate(data.events):
                if t < e.time:
                    data.events.insert(idx, ev)
                    inserted = True
                    break
            if not inserted: 
                data.events.append(ev)
