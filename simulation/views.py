from __future__ import annotations
from django.http import JsonResponse, HttpRequest, HttpResponse
from django.shortcuts import render
from django.views.decorators.http import require_http_methods
from .xml_reader import XMLReader
from .simulation_core import SimulationController
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST
from .mapping import MAPPINGS

SIM = SimulationController()

@ensure_csrf_cookie
def index(request: HttpRequest) -> HttpResponse:
    return render(request, "simulation/index.html")

@require_http_methods(["POST"])
def api_upload(request: HttpRequest) -> JsonResponse:
    file = request.FILES.get("file")
    print(file)
    if not file:
        return JsonResponse({"ok": False, "error": "Arquivo não enviado"}, status=400)
    import tempfile, os
    with tempfile.NamedTemporaryFile(delete=False, suffix=".xml") as tmp:
        for chunk in file.chunks():
            tmp.write(chunk)
        tmp_path = tmp.name
    try:
        reader = XMLReader()
        data = reader.read_dom(tmp_path)
        SIM.init(data)
        return JsonResponse({"ok": True})
    finally:
        try: os.remove(tmp_path)
        except Exception: pass

@require_http_methods(["GET"])
def api_state(request: HttpRequest) -> JsonResponse:
    SIM.tick()
    return JsonResponse(SIM.snapshot())

@csrf_exempt
@require_http_methods(["POST"])
def api_play(request: HttpRequest) -> JsonResponse:
    SIM.play()
    return JsonResponse({"ok": True})

@require_http_methods(["POST"])
def api_pause(request: HttpRequest) -> JsonResponse:
    SIM.pause()
    return JsonResponse({"ok": True})

@require_http_methods(["POST"])
def api_back(request: HttpRequest) -> JsonResponse:
    SIM.back()
    return JsonResponse({"ok": True})

@require_http_methods(["POST"])
def api_step_forward(request: HttpRequest) -> JsonResponse:
    SIM.step_forward()
    return JsonResponse({"ok": True})

@require_http_methods(["POST"])
def api_step_back(request: HttpRequest) -> JsonResponse:
    SIM.step_back()
    return JsonResponse({"ok": True})

@require_http_methods(["POST"])
def api_speed(request: HttpRequest) -> JsonResponse:
    try:
        sp = float(request.POST.get("speed", "1.0"))
    except ValueError:
        return JsonResponse({"ok": False, "error": "speed inválido"}, status=400)
    SIM.speed = max(0.05, sp)
    return JsonResponse({"ok": True, "speed": SIM.speed})

@require_POST
def api_close(request: HttpRequest) -> JsonResponse:
    SIM.close()
    return JsonResponse({"ok": True})

@require_GET
def api_mapping_list(request: HttpRequest) -> JsonResponse:
    items = [{"key": k, "label": v.label} for k,v in MAPPINGS.items()]
    return JsonResponse({"ok": True, "mappings": items, "current": SIM.mapping_key})

@require_POST
def api_mapping_set(request: HttpRequest) -> JsonResponse:
    key = (request.POST.get("key") or "").strip()
    if key not in MAPPINGS:
        return JsonResponse({"ok": False, "error": "mapping inválido"}, status=400)
    SIM.set_mapping(key)
    return JsonResponse({"ok": True, "current": SIM.mapping_key})