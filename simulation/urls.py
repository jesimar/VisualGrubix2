from django.urls import path
from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("api/upload", views.api_upload, name="api_upload"),
    path("api/state", views.api_state, name="api_state"),
    path("api/play", views.api_play, name="api_play"),
    path("api/pause", views.api_pause, name="api_pause"),
    path("api/back", views.api_back, name="api_back"),
    path("api/step_f", views.api_step_forward, name="api_step_forward"),
    path("api/step_b", views.api_step_back, name="api_step_back"),
    path("api/speed", views.api_speed, name="api_speed"),
    path("api/close", views.api_close, name="api_close"),
    path("api/mapping/list", views.api_mapping_list, name="api_mapping_list"),
    path("api/mapping/set",  views.api_mapping_set,  name="api_mapping_set"),
]
