# --- File: scene_composer.py ---
# Version with mask normalization and base prompt

import torch
import numpy as np
from PIL import Image
import base64
import io
import json

from comfy.model_management import get_torch_device

# --- Helper Functions ---

def decode_mask_from_base64(mask_b64: str, opacity: float) -> torch.Tensor:
    """
    Decodes a mask from a Base64 PNG string.
    """
    if 'base64,' in mask_b64:
        mask_b64 = mask_b64.split('base64,')[1]
    
    try:
        img_bytes = base64.b64decode(mask_b64)
        img = Image.open(io.BytesIO(img_bytes)).convert('RGBA')
        mask_np = np.array(img).astype(np.float32)[:, :, 3] / 255.0
        mask_np *= opacity
        return torch.from_numpy(mask_np)
    except Exception as e:
        print(f"[SceneComposer] Error decoding mask: {e}")
        return None


# --- Main Node Class ---

class B34tSceneComposerNode:
    @classmethod
    def INPUT_TYPES(cls):
        """
        Define the node's input types.
        """
        return {
            "required": {
                "clip": ("CLIP",),
                "width": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 8}),
                "height": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 8}), 
                "normalize_masks": ("BOOLEAN", {"default": True}),
                "add_base_prompt": ("BOOLEAN", {"default": True}),
                "base_prompt_strength": ("FLOAT", {
                    "default": 1.0, 
                    "min": 0.0, 
                    "max": 1.0,
                    "step": 0.01 
                }),
                "scene_json": ( "STRING", { "default": "", "multiline": False, }),
                "scene_data": ("B34T_SCENE_COMPOSER",),
            }
        }

    RETURN_TYPES = ("LATENT", "CONDITIONING")
    RETURN_NAMES = ("latent", "positive")
    FUNCTION = "compose_scene"
    CATEGORY = "834t_Nodes"

    def compose_scene(self, clip, width, height, normalize_masks, add_base_prompt, base_prompt_strength, scene_json, scene_data=""):
        """
        The main function of the node.
        """
        device = get_torch_device()
        latent = torch.zeros([1, 4, height // 8, width // 8], device=device)
        latent_h, latent_w = height // 8, width // 8

        try:
            data = json.loads(scene_json)
        except (json.JSONDecodeError, TypeError):
            data = {}

        if not data or not data.get('layerData') or not data.get('masks'):
            print("[SceneComposer] No data from the widget. Returning an empty conditioning.")
            tokens = clip.tokenize("")
            cond, pooled = clip.encode_from_tokens(tokens, return_pooled=True)
            return ({"samples": latent}, [[cond, {"pooled_output": pooled}]])
            
        layer_data = data['layerData']
        masks_data = data['masks']
        
        # --- 1. PRE-PROCESS LAYERS ---
        processed_layers = []
        for color_hex, mask_b64 in masks_data.items():
            layer_info = layer_data.get(color_hex, {})
            prompt = layer_info.get('prompt', '').strip()
            is_visible = layer_info.get('visible', False)
            opacity = layer_info.get('opacity', 1.0)

            if not prompt or not is_visible:
                continue

            mask = decode_mask_from_base64(mask_b64, opacity)
            if mask is None:
                continue
            
            resized_mask = torch.nn.functional.interpolate(
                mask.unsqueeze(0).unsqueeze(0),
                size=(latent_h, latent_w),
                mode="bilinear"
            ).squeeze(0).squeeze(0)
            
            processed_layers.append({'prompt': prompt, 'mask_tensor': resized_mask})

        if not processed_layers:
            print("[SceneComposer] No visible layers found. Returning an empty conditioning.")
            tokens = clip.tokenize("")
            cond, pooled = clip.encode_from_tokens(tokens, return_pooled=True)
            return ({"samples": latent}, [[cond, {"pooled_output": pooled}]])

        # --- 2. NORMALIZE MASKS (if enabled) ---
        masks_to_process = [layer['mask_tensor'] for layer in processed_layers]
        
        if normalize_masks and masks_to_process:
            masks_stack = torch.stack(masks_to_process, dim=0)
            total_weight = torch.sum(masks_stack, dim=0)
            # Add a small epsilon to avoid division by zero, and clamp the minimum at 1.0
            normalizer = 1.0 / torch.clamp(total_weight, min=1.0)
            normalized_masks_stack = masks_stack * normalizer.unsqueeze(0)
            # Update the masks in our processed layers
            for i, layer in enumerate(processed_layers):
                layer['mask_tensor'] = normalized_masks_stack[i]

        # --- 3. ASSEMBLE FINAL CONDITIONING ---
        final_conditioning = []

        # 3.1. Create and add the base prompt (if enabled)
        if add_base_prompt and base_prompt_strength > 0:
            all_prompts = [layer['prompt'] for layer in processed_layers]
            base_prompt_text = ", ".join(all_prompts)
            print(f"[SceneComposer] Base prompt (strength: {base_prompt_strength}): {base_prompt_text}")

            base_tokens = clip.tokenize(base_prompt_text)
            base_cond, base_pooled = clip.encode_from_tokens(base_tokens, return_pooled=True)
                
            # apply baseprompt strenght
            if base_prompt_strength < 1.0:
                base_cond = base_cond * base_prompt_strength

            # Add base conditioning without a mask
            final_conditioning.append([base_cond, {"pooled_output": base_pooled}])
            
        # 3.2. Add regional conditioning for each layer
        for layer in processed_layers:
            prompt = layer['prompt']
            mask_tensor = layer['mask_tensor']

            tokens = clip.tokenize(prompt)
            cond, pooled = clip.encode_from_tokens(tokens, return_pooled=True)

            final_conditioning.append([cond, {
                "pooled_output": pooled,
                "mask": mask_tensor.unsqueeze(0).to(device), # Add batch dimension
            }])

        print(f"[SceneComposer] Assembled {len(final_conditioning)} conditionings (including base, if enabled).")
        
        return ({"samples": latent}, final_conditioning)


# --- Node Registration ---
NODE_CLASS_MAPPINGS = {
    "B34tSceneComposerNode": B34tSceneComposerNode
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "B34tSceneComposerNode": "Scene Composer (834t)"
}
