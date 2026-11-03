"""ComfyUI comme moteur, en arrière-plan.

ComfyUI est d'abord un serveur HTTP : son interface à nœuds n'est qu'un
client. ScreenComfy le lance sans fenêtre (ou se branche sur un serveur
déjà ouvert), lui envoie des workflows au format API, suit la progression
et récupère les fichiers. N'importe quel workflow exporté depuis ComfyUI
(« Export (API) ») devient ainsi une tâche : vidéo, image, 3D, audio.
"""

from .server import ComfyServer, find_comfy_python
from .workflow import Analysis, analyze, fill, load_workflow

__all__ = ["ComfyServer", "find_comfy_python", "Analysis", "analyze", "fill", "load_workflow"]
