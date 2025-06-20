# --- File: __init__.py ---
# This code ensures the proper integration of the node and its JavaScript file into ComfyUI.

import os
import shutil
import __main__

# Get the absolute path to the main ComfyUI directory
comfy_path = os.path.dirname(os.path.realpath(__main__.__file__))
# Path to the web directory
web_dir = os.path.join(comfy_path, "web")
# Path to our extension's directory within web
js_dest_dir = os.path.join(web_dir, "extensions", "b34t_scene_composer")

# Get the absolute path to our custom node's directory
node_path = os.path.dirname(__file__)
# Path to the js directory inside our node
js_source_dir = os.path.join(node_path, "js")

# Create the destination directory if it doesn't exist
os.makedirs(js_dest_dir, exist_ok=True)

# Copy our js file
files_to_copy = ["b34t_scene_composer.js"]
for file in files_to_copy:
    src_path = os.path.join(js_source_dir, file)
    dest_path = os.path.join(js_dest_dir, file)
    if os.path.exists(src_path):
        shutil.copy(src_path, dest_path)

# --- Standard node registration ---
from .b34t_scene_composer import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

# --- Tell ComfyUI to load JS files from this directory ---
WEB_DIRECTORY = "./js"

# Export all necessary variables
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']