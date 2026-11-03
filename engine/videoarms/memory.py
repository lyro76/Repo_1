"""Stratégie mémoire : comment faire tenir un modèle de 15 à 30 Go sur un GPU
de 10 Go quand la machine a 64 Go de RAM.

Même idée que les moteurs « experts streamés » pour LLM : seule une partie
des poids vit sur le GPU, le reste est amené depuis la RAM pendant le calcul.
Avec un modèle distillé à 8 étapes, le transfert PCIe coûte moins que le
calcul ; avec 50 étapes, il domine. D'où le choix selon le modèle.
"""

from __future__ import annotations

from dataclasses import dataclass

STRATEGIES = ("gpu", "cpu_offload", "group_offload")

LABELS = {
    "gpu": "tout sur le GPU",
    "cpu_offload": "un composant à la fois sur le GPU (reste en RAM)",
    "group_offload": "blocs streamés depuis la RAM pendant le calcul",
}


@dataclass
class Plan:
    strategy: str
    vae_tiling: bool
    reason: str
    # Pour group_offload : blocs du transformer chargés ensemble.
    blocks_per_group: int = 2

    def to_dict(self) -> dict:
        return {**self.__dict__, "label": LABELS.get(self.strategy, self.strategy)}


def plan(requested: str, model_gb: float, vram_mb: int, ram_free_mb: int, width: int, height: int, steps: int) -> Plan:
    """Choisit la stratégie. `requested` = auto ou un nom de STRATEGIES."""
    pixels = width * height
    # Le VAE vidéo en pleine résolution réclame plusieurs Go : tuilé dès 720p.
    tiling = pixels >= 1280 * 720 or vram_mb < 12_000
    if requested in STRATEGIES:
        return Plan(requested, tiling, "choisi par l'utilisateur")
    vram_gb = vram_mb / 1024
    if vram_mb == 0:
        return Plan("cpu_offload", True, "pas de GPU détecté")
    # Marge pour les activations : grandit avec la résolution.
    activations_gb = 1.5 + pixels / (1280 * 720) * 1.5
    if model_gb + activations_gb <= vram_gb * 0.9:
        return Plan("gpu", tiling, f"le modèle ({model_gb} Go) tient dans la VRAM ({vram_gb:.0f} Go)")
    if ram_free_mb / 1024 < model_gb * 1.2:
        return Plan("cpu_offload", True, f"RAM libre insuffisante ({ram_free_mb // 1024} Go) pour streamer : composant par composant")
    if steps <= 12:
        return Plan("group_offload", True, f"modèle de {model_gb} Go > VRAM : blocs streamés depuis la RAM ({steps} étapes, transfert supportable)")
    return Plan("cpu_offload", True, f"modèle de {model_gb} Go > VRAM et {steps} étapes : composant par composant, le streaming coûterait trop")
