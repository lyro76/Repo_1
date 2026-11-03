"""Ce que les backends diffusers partagent : application du plan mémoire,
attention rapide, compilation, mesure VRAM/RAM. Importé seulement quand
torch est présent.
"""

from __future__ import annotations

import gc
import sys

from ..memory import Plan


def pick_dtype():
    import torch

    # bf16 n'est accéléré qu'à partir d'Ampere (RTX 30xx) ; fp16 sinon.
    if torch.cuda.is_available() and torch.cuda.get_device_capability(0)[0] >= 8:
        return torch.bfloat16
    return torch.float16


def apply_plan(pipe, plan: Plan, transformer_attr: str = "transformer", em=None) -> None:
    """Place les composants selon la stratégie choisie."""
    import torch

    if plan.strategy == "gpu":
        pipe.to("cuda")
    elif plan.strategy == "cpu_offload":
        pipe.enable_model_cpu_offload()
    else:
        from diffusers.hooks import apply_group_offloading

        onload = torch.device("cuda")
        offload = torch.device("cpu")
        # Le transformer est streamé bloc par bloc avec préchargement ; les
        # autres composants (encodeur de texte, VAE) vont et viennent entiers.
        for name, comp in pipe.components.items():
            if not isinstance(comp, torch.nn.Module):
                continue
            if name == transformer_attr:
                apply_group_offloading(comp, onload_device=onload, offload_device=offload, offload_type="block_level",
                                       num_blocks_per_group=plan.blocks_per_group, use_stream=True, record_stream=True)
            else:
                apply_group_offloading(comp, onload_device=onload, offload_device=offload, offload_type="leaf_level", use_stream=True)
    if plan.vae_tiling and hasattr(pipe, "vae"):
        try:
            pipe.vae.enable_tiling()
        except Exception as e:  # pragma: no cover
            if em:
                em.log(f"VAE tuilé indisponible : {e}")


def apply_attention(pipe, use_sage: bool, em=None, transformer_attr: str = "transformer") -> str:
    """Active SageAttention si demandé et disponible. Renvoie le nom du backend d'attention."""
    if not use_sage:
        return "sdpa"
    try:
        tr = getattr(pipe, transformer_attr)
        tr.set_attention_backend("sage")
        return "sage"
    except Exception as e:
        if em:
            em.log(f"SageAttention indisponible, attention standard utilisée : {e}")
        return "sdpa"


def maybe_compile(pipe, enabled: bool, em=None, transformer_attr: str = "transformer") -> bool:
    if not enabled:
        return False
    import torch

    if sys.platform == "win32" and em:
        em.log("torch.compile sous Windows demande les Build Tools Visual C++ ; en cas d'échec, désactive la compilation")
    try:
        tr = getattr(pipe, transformer_attr)
        setattr(pipe, transformer_attr, torch.compile(tr, mode="max-autotune-no-cudagraphs", dynamic=False))
        return True
    except Exception as e:
        if em:
            em.log(f"compilation impossible, modèle non compilé : {e}")
        return False


def reset_peaks() -> None:
    import torch

    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()


def peaks() -> tuple[int, int]:
    """(pic VRAM Mo, RAM utilisée par ce processus Mo)."""
    import torch

    vram = torch.cuda.max_memory_allocated() // (1024 * 1024) if torch.cuda.is_available() else 0
    ram = 0
    try:
        import psutil

        ram = psutil.Process().memory_info().rss // (1024 * 1024)
    except Exception:
        pass
    return vram, ram


def free_text_encoder(pipe, em=None) -> None:
    """Après l'encodage, l'encodeur de texte (Gemma : plusieurs Go) n'a plus rien à faire sur le GPU."""
    import torch

    te = getattr(pipe, "text_encoder", None)
    if te is None:
        return
    try:
        te.to("cpu")
        torch.cuda.empty_cache()
    except Exception as e:  # pragma: no cover
        if em:
            em.log(f"encodeur de texte non déchargé : {e}")


def step_callback(em, cancel, total: int, timings):
    """Callback diffusers : progression par pas et annulation."""
    import time

    state = {"t": time.perf_counter(), "steps": []}

    def cb(pipe, step, timestep, kwargs):
        now = time.perf_counter()
        state["steps"].append(now - state["t"])
        state["t"] = now
        em.progress(step + 1, total, state["steps"][-1])
        if cancel.is_set():
            from . import Cancelled

            raise Cancelled()
        if state["steps"]:
            timings.seconds_per_step = round(sum(state["steps"]) / len(state["steps"]), 3)
        return kwargs

    return cb
