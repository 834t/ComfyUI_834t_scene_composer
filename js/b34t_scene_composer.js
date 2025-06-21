// --- File: js/scene_composer.js --- 

import { app } from "/scripts/app.js";

const tmpCan = document.createElement('canvas');
const tmpCtx = tmpCan.getContext('2d');

/**
 * Displays an image from any canvas element directly in the developer console.
 * @param {HTMLCanvasElement} canvas - The canvas element to display.
 * @param {string} [label="Canvas Log"] - A descriptive label for the console output.
 * @param {number} [scale=0.5] - A scale factor to make large canvases fit in the console.
 */
function logCanvas(canvas, label = "Canvas Log", scale = 0.5) {
    if (!(canvas instanceof HTMLCanvasElement)) {
        console.error("Error: The provided item is not a valid canvas element.", canvas);
        return;
    }

    if (canvas.width === 0 || canvas.height === 0) {
        console.log(`%c[${label}]`, "font-weight:bold;", "Canvas is empty (0x0 pixels).");
        return;
    }

    const dataURL = canvas.toDataURL();
    
    const css = [
        `background-image: url(${dataURL})`,
        `background-size: ${canvas.width * scale}px ${canvas.height * scale}px`,
        'background-repeat: no-repeat',
        `padding: ${canvas.height * scale / 2}px ${canvas.width * scale / 2}px`,
        'border: 1px solid #ccc'
    ].join(';');

    console.groupCollapsed(`%c[${label}] %c(click to expand/view)`, "font-weight:bold;", "color:gray; font-weight:normal;");
    console.log('%c ', css);
    console.log("Data URL:", dataURL);
    console.log("Canvas Element:", canvas);
    console.groupEnd();
} 

// --- 1. STYLES --- (unchanged)
const style = document.createElement('style');
style.textContent = `
    .sc-container { display: flex; flex-direction: column; gap: 5px; }
    .sc-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 2px 0; }
    .sc-toolbar-group { display: flex; align-items: center; gap: 4px; padding: 2px 4px; border: 1px solid var(--border-color); border-radius: 4px;}
    .sc-toolbar-btn { font-size: 16px; min-width: 28px; height: 28px; border: 1px solid transparent; border-radius: 4px; cursor: pointer; background-color: var(--comfy-input-bg); color: var(--input-text); }
    .sc-toolbar-btn:hover { border-color: var(--input-border-color); }
    .sc-toolbar-btn.active { background-color: var(--comfy-menu-bg); border-color: var(--descrip-text-color); box-shadow: 0 0 3px var(--descrip-text-color); }
    .sc-palette-btn { width: 20px; height: 20px; border: 2px solid var(--comfy-input-bg); border-radius: 50%; cursor: pointer; box-sizing: border-box; }
    .sc-palette-btn.active { border-color: var(--descrip-text-color); transform: scale(1.15); box-shadow: 0 0 5px var(--descrip-text-color); }
    .sc-prompt-input { resize: none; width: 100%; min-height: 150px; box-sizing: border-box; }
    .sc-canvas-container { position: relative; width: 100%; border: 1px dashed var(--input-border-color); line-height: 0; border: 1px #fff dashed; }
    .sc-canvas { display: block; width: 100%; height: auto; image-rendering: pixelated; cursor: none; }
`;
document.head.appendChild(style);

// --- 2. MAIN WIDGET OBJECT --- (unchanged)
const SceneComposerWidget = {
    init(node, inputName, inputData, app) {

        // Hide the underlying json widget from the user
        let jsonWidget; 

        const container = document.createElement("div"); 
        container.className = "sc-container";
        
        const widget = node.addDOMWidget(inputName, "div", container, {
            node: node, 
            name: inputName, 
            type: "B34T_SCENE_COMPOSER", 
            y: inputData.y,
            value: inputData.value || {},  
            draw: function() {},
            computeSize: function(width) {
                const canvasEl = this.canvas_el;
                if (!canvasEl || !canvasEl.width) return [width, 100];
                const aspectRatio = canvasEl.height / canvasEl.width;
                return [width, (width * aspectRatio) + 80];
            },
            serialize: true, // include this in prompt.
        }); 
 
        widget.computeSize = function(width) {
            const canvasEl = this.canvas_el;
            if (!canvasEl || !canvasEl.width) return [width, 100];
            const aspectRatio = canvasEl.height / canvasEl.width;
            const toolbarHeight = toolbar.getClientRects().item(0);
            const offsetHeight = (toolbarHeight?.height * 1.5 || 30) + 380;
            return [width, (width * aspectRatio) + offsetHeight];
        }

        const COLORS = ["#FF4136", "#01FF70", "#0074D9", "#FFDC00", "#B10DC9", "#7FDBFF", "#FF851B", "#F012BE"];
        const state = {
            activeColor: COLORS[0], activeTool: 'brush', brushSize: 20, isDrawing: false, lineStart: null,
            layerCanvases: {},
            layerData: Object.fromEntries(COLORS.map(c => [c, { prompt: "", opacity: 0.5, visible: true }])),
        };
        const logic = new WidgetLogic(node, widget, state, COLORS);
        const { canvas, bufferCanvas, toolbar } = this.createDOM(container, logic, COLORS);
        widget.canvas_el = canvas;
        state.ui = { canvas, bufferCanvas, container };
        state.global_can = canvas;
        state.ctx = canvas.getContext('2d');
        state.bufferCtx = bufferCanvas.getContext('2d');
        COLORS.forEach(color => { state.layerCanvases[color] = document.createElement('canvas'); });

        widget.serializeValue = function (){  
            logic.syncValue();
            jsonWidget.value = logic.serialize(); 
            this.value = jsonWidget.value; 
            return jsonWidget.value;
        };

        const widthWidget = node.widgets.find(w => w.name === "width");
        const heightWidget = node.widgets.find(w => w.name === "height");
        const resizeCallback = () => {
            logic.resizeAllCanvases(widthWidget.value, heightWidget.value);
            node.setSize(widget.computeSize(node.size[0]));
        };
        widthWidget.callback = resizeCallback;
        heightWidget.callback = resizeCallback;

        const original_onResize = node.onResize;
        node.onResize = function(size) {
            original_onResize?.apply(this, arguments); 
            size[1] = widget.computeSize(size[0])[1];
        };
  
        widget.beforeQueued = function (){
            this.serializeValue();
            console.log("[SceneComposer] beforeQueued hook triggered on the main widget. Syncing...");
            // logic.syncValue() will update widget.value right before ComfyUI reads it.
            this.value = 1; // This might be a placeholder/legacy value, keeping as is.
        };

        setTimeout(() => {
            if (widget.value) { logic.deserialize(widget.value); }
            logic.setActiveTool('brush');
            logic.setActiveLayer(COLORS[0]);
            resizeCallback();
        }, 0);
        
        setTimeout(() => { 
            for(const w of node.widgets){ 
                if(w.name === "scene_json"){
                    jsonWidget = w;
                    jsonWidget.hidden = true;  
                    if( jsonWidget.value != "" ){
                        try{
                            const nextJSON = JSON.parse( jsonWidget.value );
                            logic.deserialize( nextJSON );
                        } catch( err ){
                            console.log( 'Error at attempt to deserialize previouse Scene Composer data', err );
                        }
                    }
                }
            }  
        }, 15);

        return widget;
    },
    createDOM(container, logic, COLORS) {
        const BRUSH_MAX_SIZE = 200;
        const toolbar = document.createElement("div"); toolbar.className = "sc-toolbar";
        const toolsGroup = document.createElement("div"); toolsGroup.className = "sc-toolbar-group";
        const brushBtn = this.createButton("🖌️", "brush", "Brush", () => logic.setActiveTool('brush'));
        const lineBtn = this.createButton("╱", "line", "Line", () => logic.setActiveTool('line'));
        const eraserBtn = this.createButton("🧼", "eraser", "Eraser", () => logic.setActiveTool('eraser'));
        toolsGroup.append(brushBtn, lineBtn, eraserBtn);
        const sizeSlider = this.createSlider(1, BRUSH_MAX_SIZE, 20, (e) => logic.setBrushSize(e.target.value));
        const paletteGroup = document.createElement("div"); paletteGroup.className = "sc-toolbar-group";
        COLORS.forEach(color => {
            const btn = document.createElement("button"); btn.className = "sc-palette-btn";
            btn.style.backgroundColor = color; btn.dataset.color = color;
            btn.onclick = () => logic.setActiveLayer(color);
            paletteGroup.appendChild(btn);
        });
        const opacitySlider = this.createSlider(0, 1, 0.5, (e) => logic.setActiveLayerOpacity(e.target.value), 0.05);
        const layerMgmtGroup = document.createElement("div"); layerMgmtGroup.className = "sc-toolbar-group";
        const visibilityBtn = this.createButton("👁️", "visibility", "Layer Visibility", logic.toggleActiveLayerVisibility.bind(logic));
        const saveBtn = this.createButton("S", "save", "Save Scene", logic.saveStateToFile.bind(logic));
        const loadBtn = this.createButton("L", "load", "Load Scene", logic.loadStateFromFile.bind(logic));
        layerMgmtGroup.append(visibilityBtn, saveBtn, loadBtn);
        toolbar.append(toolsGroup, sizeSlider, paletteGroup, opacitySlider, layerMgmtGroup);
        const promptInput = document.createElement("textarea");
        promptInput.className = "sc-prompt-input"; promptInput.placeholder = "Prompt for active layer...";
        promptInput.oninput = (e) => logic.updatePrompt(e.target.value);
        const canvasContainer = document.createElement("div"); 
        canvasContainer.className = "sc-canvas-container"; 
        const canvas = document.createElement("canvas"); 
        canvas.className = "sc-canvas";
        const bufferCanvas = document.createElement('canvas'); 
        bufferCanvas.className = "sc-canvas";
        bufferCanvas.style.cssText = "position: absolute; top: 0; left: 0; pointer-events: none;";

        canvasContainer.append(canvas, bufferCanvas);
        canvas.onmousedown = (e) => logic.startDrawing(e);
        canvas.onmousemove = (e) => logic.draw(e);
        canvas.onmouseup = (e) => logic.stopDrawing(e);
        canvas.onmouseleave = (e) => logic.stopDrawing(e, true);
        container.append(toolbar, promptInput, canvasContainer);
        return { canvas, bufferCanvas, toolbar };
    },
    createButton(text, id, title, onClick) {
        const btn = document.createElement("button"); btn.className = "sc-toolbar-btn"; btn.textContent = text;
        btn.id = `sc-btn-${id}`; btn.title = title; btn.onclick = onClick; return btn;
    },
    createSlider(min, max, value, onInput, step = 1) {
        const slider = document.createElement("input"); slider.type = "range"; slider.min = min; slider.max = max;
        slider.value = value; slider.step = step; slider.oninput = onInput; return slider;
    }
};


// --- 3. LOGIC CLASS ---
class WidgetLogic {
    constructor(node, widget, state, colors) {
        this.node = node; 
        this.widget = widget; 
        this.state = state; 
        this.COLORS = colors;
        this.lastPos = { x: 0, y: 0 };
        this.mask_optimisation_factor = 16;
    }
    
    // --- UI Management --- (unchanged)
    setActiveTool(tool) {
        this.state.activeTool = tool;
        this.state.ui.container.querySelector(`#sc-btn-${tool}`)?.parentElement.querySelectorAll('.sc-toolbar-btn').forEach(b => b.classList.remove('active'));
        this.state.ui.container.querySelector(`#sc-btn-${tool}`)?.classList.add('active');
    }

    setBrushSize(size) { 
        this.state.brushSize = parseInt(size, 10); 
    }

    setActiveLayer(color) {
        this.state.activeColor = color;
        const data = this.state.layerData[color]; if (!data) return;
        const container = this.state.ui.container;
        container.querySelectorAll('.sc-palette-btn').forEach(b => { b.classList.toggle('active', b.dataset.color === color); });
        container.querySelector('.sc-prompt-input').value = data.prompt;
        container.querySelector('input[type="range"][step="0.05"]').value = data.opacity;
        container.querySelector('#sc-btn-visibility').style.opacity = data.visible ? '1' : '0.4';
        this.redrawVisibleCanvas();
    }

    updatePrompt(text) { 
        this.state.layerData[this.state.activeColor].prompt = text; 
        this.syncValue(); 
    }

    setActiveLayerOpacity(opacity) { 
        this.state.layerData[this.state.activeColor].opacity = parseFloat(opacity); 
        this.redrawVisibleCanvas(); 
        this.syncValue(); 
    }

    toggleActiveLayerVisibility() {
        const data = this.state.layerData[this.state.activeColor]; data.visible = !data.visible;
        this.state.ui.container.querySelector('#sc-btn-visibility').style.opacity = data.visible ? '1' : '0.4';
        this.redrawVisibleCanvas(); 
        this.syncValue();
    }

    // --- DRAWING LOGIC (FINAL VERSION) ---
    resizeAllCanvases(w, h) {
 
        [...Object.values(this.state.layerCanvases)].forEach(c => { 
            if (c) { 
                tmpCan.width = parseInt(c.width);
                tmpCan.height = parseInt(c.height);
                tmpCtx.clearRect( 0, 0, tmpCan.width, tmpCan.height );
                tmpCtx.drawImage( c, 0, 0, c.width, c.height, 0, 0, tmpCan.width, tmpCan.height );
                c.width = w; 
                c.height = h;   
                c.getContext('2d').drawImage( tmpCan, 0, 0, tmpCan.width, tmpCan.height, 0, 0, w, h );
            }
        });
        

        [this.state.ui.canvas, this.state.ui.bufferCanvas].forEach(c => {
            if (c) {  
                c.width = w; 
                c.height = h;  
            }
        });

        this.redrawVisibleCanvas();
    }

    getMousePos(e) {
        const rect = this.state.ui.canvas.getBoundingClientRect();
        const scaleX = this.state.ui.canvas.width / rect.width;
        const scaleY = this.state.ui.canvas.height / rect.height;
        return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    }

    showCursor( ctx, pos ){
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        const radius = this.state.brushSize / 2;
        ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.restore();
        this.redrawVisibleCanvas();
    }
    
    startDrawing(e) {
        this.state.isDrawing = true;
        this.lastPos = this.getMousePos(e);
        if (this.state.activeTool === 'line') {
            this.state.lineStart = this.lastPos;
        } else {
            // For brush and eraser - draw the first point immediately
            this.draw(e);
        }
    }
    
    draw(e) {
        const pos = this.getMousePos(e);
        const bCtx = this.state.bufferCtx;

        this.showCursor( bCtx, pos );

        if (!this.state.isDrawing) return;
        
        const setupCtx = (ctx) => {
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.lineWidth = this.state.brushSize;
        };

        if (this.state.activeTool === 'line') {
            // For a line, use the temporary buffer for previewing
            bCtx.clearRect(0, 0, bCtx.canvas.width, bCtx.canvas.height);
            setupCtx(bCtx);
            bCtx.strokeStyle = this.state.activeColor;
            bCtx.globalAlpha = 0.8;
            bCtx.beginPath();
            bCtx.moveTo(this.state.lineStart.x, this.state.lineStart.y);
            bCtx.lineTo(pos.x, pos.y);
            bCtx.stroke();
        } else {
            // For brush/eraser, draw on the layer's data canvas
            const layerCtx = this.state.layerCanvases[this.state.activeColor].getContext('2d');
            setupCtx(layerCtx);
            layerCtx.strokeStyle = this.state.activeColor;
            layerCtx.globalCompositeOperation = (this.state.activeTool === 'eraser') ? 'destination-out' : 'source-over';
            layerCtx.beginPath();
            layerCtx.moveTo(this.lastPos.x, this.lastPos.y);
            layerCtx.lineTo(pos.x, pos.y);
            layerCtx.stroke();
        }
        this.lastPos = pos;
    }
    
    stopDrawing(e, isMouseLeave = false) {
        if (!this.state.isDrawing) return;
        this.state.isDrawing = false;
        
        // If it was a line, finalize it on the layer's canvas
        if (this.state.activeTool === 'line' && this.state.lineStart && !isMouseLeave) {
            const finalPos = this.getMousePos(e);
            const layerCtx = this.state.layerCanvases[this.state.activeColor].getContext('2d');
            const setupCtx = (ctx) => { ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = this.state.brushSize; };
            setupCtx(layerCtx);
            layerCtx.strokeStyle = this.state.activeColor;
            layerCtx.globalCompositeOperation = 'source-over';
            layerCtx.beginPath();
            layerCtx.moveTo(this.state.lineStart.x, this.state.lineStart.y);
            layerCtx.lineTo(finalPos.x, finalPos.y);
            layerCtx.stroke();
        }

        // logCanvas(this.state.layerCanvases[this.state.activeColor], this.state.activeColor, 0.5);
        // Clear the line buffer
        this.state.bufferCtx.clearRect(0, 0, this.state.bufferCtx.canvas.width, this.state.bufferCtx.canvas.height);
          
        // Perform a final, correct redraw of the entire scene
        this.redrawVisibleCanvas();
        this.syncValue();
    }

    redrawVisibleCanvas() {
        const ctx = this.state.ctx;
        if (!ctx) return;
    
        // 1. Clear the final canvas
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
        this.COLORS.forEach(color => {
            const data = this.state.layerData[color];
            const layerCanvas = this.state.layerCanvases[color];
    
            if (data && data.visible && layerCanvas.width > 0) {
                // Set the opacity for this layer
                ctx.globalAlpha = data.opacity; 
                ctx.drawImage(layerCanvas, 0, 0); 
                ctx.globalAlpha = 1.0; // Reset opacity
            }
        });
 
        // Final check in the console
        // logCanvas(this.state.global_can, 'global_layer', 0.5);
    }

    // --- Serialization and File Operations --- (unchanged)
    syncValue() {  
        this.widget.options.value = this.serialize(true);  
        this.widget.value = this.widget.options.value;  
    }

    serialize(forWidgetValue = false) {
        const data = { version: 2, layerData: this.state.layerData, masks: {} };
        const factorWidget = this.node.widgets.find(w => w.name === "mask_downscale_factor");
        const optimisationFactor = factorWidget ? factorWidget.value : this.mask_optimisation_factor; 
        for (const color in this.state.layerCanvases) {
            const canvas = this.state.layerCanvases[color];
            if(canvas.width > 0 && canvas.height > 0) {
                const hasContent = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((channel, i) => (i + 1) % 4 === 0 && channel > 0);
                if (hasContent) {
                    tmpCan.width = parseInt(canvas.width / optimisationFactor);
                    tmpCan.height = parseInt(canvas.height / optimisationFactor);
                    tmpCtx.clearRect( 0, 0, tmpCan.width, tmpCan.height );
                    tmpCtx.drawImage(canvas, 0, 0, tmpCan.width, tmpCan.height);
                    // logCanvas(tmpCan);
                    const nextMask = tmpCan.toDataURL('image/png');
                    data.masks[color] = nextMask;
                } else {
                    data.masks[color] = '';
                }
            }
        }
        return forWidgetValue ? data : JSON.stringify(data);
    }

    deserialize(data) {
        try {
            const stateData = (typeof data === 'string') ? JSON.parse(data) : data;
            if (!stateData || !stateData.layerData) throw new Error("Invalid state data.");
            
            Object.assign(this.state.layerData, stateData.layerData);
            if (!stateData.masks) { this.redrawVisibleCanvas(); this.syncValue(); return; }
            const promises = Object.entries(stateData.masks).map(([color, src]) => {
                return new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = this.state.layerCanvases[color];
                        if (canvas) {
                            const ctx = canvas.getContext('2d');
                            ctx.clearRect(0,0,canvas.width, canvas.height); 
                            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                        } 
                        resolve();
                    };
                    img.onerror = resolve;
                    img.src = src;
                });
            });
            Promise.all(promises).then(() => { 
                this.redrawVisibleCanvas(); 
                this.syncValue(); 
            });
        } catch (e) { console.error("Failed to deserialize Scene Composer state:", e); }
    }
    
    saveStateToFile() { 
        const jsonString = this.serialize(false); 
        const blob = new Blob([jsonString], { type: "application/json" }); 
        const now = new Date(); 
        const timestamp = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}${now.getSeconds().toString().padStart(2,'0')}`; 
        const a = document.createElement("a"); 
        a.href = URL.createObjectURL(blob); 
        a.download = `scene_composer_${timestamp}.json`;
        document.body.appendChild(a); 
        a.click(); 
        document.body.removeChild(a); 
        URL.revokeObjectURL(a.href); 
    }
    
    loadStateFromFile() { 
        const hasData = Object.values(this.state.layerData).some(d => d.prompt !== "") || Object.values(this.state.layerCanvases).some(c => c.width > 0 && c.getContext('2d').getImageData(0,0,c.width, c.height).data.some(v => v>0)); 
        if (hasData) { 
            if (!confirm("This will overwrite your current scene. Are you sure?")) { 
                return; 
            } 
        } 
        const input = document.createElement("input"); 
        input.type = "file"; 
        input.accept = ".json,application/json"; 
        input.onchange = (e) => { 
            const file = e.target.files[0]; 
            if (file) { 
                const reader = new FileReader(); 
                reader.onload = (re) => this.deserialize(re.target.result); 
                reader.readAsText(file); 
            } 
        }; 
        input.click(); 
    }
}

// --- 4. REGISTRATION --- (unchanged)
app.registerExtension({
    name: "Comfy.B34tSceneComposer",
    async getCustomWidgets() { 
        return { 
            B34T_SCENE_COMPOSER: (node, inputName, inputData, app) => SceneComposerWidget.init(node, inputName, inputData, app) 
        }; 
    }, 
    async addCustomNodeDefs(defs) {
        if (defs["B34tSceneComposerNode"]) {
            const input = defs["B34tSceneComposerNode"].input.required.scene_data;
            if (input) { input[0] = "B34T_SCENE_COMPOSER"; }
        }
    }
});
