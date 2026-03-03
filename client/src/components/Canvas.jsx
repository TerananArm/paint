import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { clsx } from "clsx";

const THROTTLE_MS = 16;
const VIRTUAL_W = 1920;
const VIRTUAL_H = 1080;

// ===== Scanline Flood Fill =====
function hexToRgba(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b, 255];
}

function scanlineFill(imageData, startX, startY, fillRgba, tolerance = 32) {
    const { data, width, height } = imageData;
    startX = Math.floor(startX);
    startY = Math.floor(startY);
    if (startX < 0 || startX >= width || startY < 0 || startY >= height) return false;

    const idx = (startY * width + startX) * 4;
    const tR = data[idx], tG = data[idx + 1], tB = data[idx + 2], tA = data[idx + 3];
    const [fR, fG, fB, fA] = fillRgba;

    // Don't fill if same color
    if (Math.abs(tR - fR) < 5 && Math.abs(tG - fG) < 5 && Math.abs(tB - fB) < 5) return false;

    const matches = (i) =>
        Math.abs(data[i] - tR) <= tolerance &&
        Math.abs(data[i + 1] - tG) <= tolerance &&
        Math.abs(data[i + 2] - tB) <= tolerance &&
        Math.abs(data[i + 3] - tA) <= tolerance;

    const paint = (i) => {
        data[i] = fR; data[i + 1] = fG; data[i + 2] = fB; data[i + 3] = fA;
    };

    const stack = [[startX, startY]];

    while (stack.length > 0) {
        let [x, y] = stack.pop();
        let i = (y * width + x) * 4;

        // Move left
        while (x > 0 && matches((y * width + x - 1) * 4)) x--;
        i = (y * width + x) * 4;

        let spanUp = false, spanDown = false;

        while (x < width && matches(i)) {
            paint(i);

            if (y > 0) {
                const above = ((y - 1) * width + x) * 4;
                if (matches(above) && !spanUp) { stack.push([x, y - 1]); spanUp = true; }
                else if (!matches(above)) spanUp = false;
            }
            if (y < height - 1) {
                const below = ((y + 1) * width + x) * 4;
                if (matches(below) && !spanDown) { stack.push([x, y + 1]); spanDown = true; }
                else if (!matches(below)) spanDown = false;
            }
            x++;
            i += 4;
        }
    }
    return true;
}

const Canvas = forwardRef(({ color, brushSize, tool, socket, layers, activeLayerId, splitMode, splitSide, penOnly, zoom = 1, pan = { x: 0, y: 0 } }, ref) => {
    const canvasRef = useRef(null);
    const overlayRef = useRef(null);
    const ctxRef = useRef(null);
    const overlayCtxRef = useRef(null);
    const isDrawing = useRef(false);
    const lastPoint = useRef(null);
    const shapeStart = useRef(null);
    const lastEmitTime = useRef(0);
    const pointBuffer = useRef([]);
    const throttleTimer = useRef(null);
    const scaleRef = useRef(1);
    const offsetRef = useRef({ x: 0, y: 0 });
    const displaySize = useRef({ w: 0, h: 0 });
    const dprRef = useRef(1);

    // Action-based history
    const actionsRef = useRef([]);
    const redoStackRef = useRef([]);
    const currentStrokeRef = useRef(null);
    const remoteStrokeRef = useRef(null);
    const layersRef = useRef(layers);

    useEffect(() => { layersRef.current = layers; }, [layers]);

    const isShapeTool = ['rect', 'circle', 'line'].includes(tool);
    const isFillTool = tool === 'fill';

    // ===== Canvas Setup =====
    const calcFit = useCallback((containerW, containerH) => {
        const scaleX = containerW / VIRTUAL_W;
        const scaleY = containerH / VIRTUAL_H;
        const scale = Math.min(scaleX, scaleY);
        return { scale, offsetX: (containerW - VIRTUAL_W * scale) / 2, offsetY: (containerH - VIRTUAL_H * scale) / 2 };
    }, []);

    useEffect(() => {
        const setupCanvas = () => {
            const canvas = canvasRef.current;
            const overlay = overlayRef.current;
            const parent = canvas.parentElement;

            // Note: with transform we use the parent container to calculate native scaling
            const w = parent.parentElement.clientWidth;
            const h = parent.parentElement.clientHeight;
            const dpr = window.devicePixelRatio || 1;
            dprRef.current = dpr;
            displaySize.current = { w, h };
            const { scale, offsetX, offsetY } = calcFit(w, h);
            scaleRef.current = scale;
            offsetRef.current = { x: offsetX, y: offsetY };

            [canvas, overlay].forEach((c) => {
                c.style.width = w + 'px';
                c.style.height = h + 'px';
                c.width = w * dpr;
                c.height = h * dpr;
            });

            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.imageSmoothingEnabled = true;
            ctxRef.current = ctx;

            ctx.fillStyle = '#111122';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(offsetX, offsetY, VIRTUAL_W * scale, VIRTUAL_H * scale);

            const oCtx = overlay.getContext('2d');
            oCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            oCtx.lineCap = 'round';
            oCtx.lineJoin = 'round';
            overlayCtxRef.current = oCtx;
        };

        setupCanvas();
        const handleResize = () => { setupCanvas(); redrawAll(); };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [calcFit]);

    // ===== Coordinate Conversion =====
    const virtualToScreen = useCallback((vx, vy) => {
        const s = scaleRef.current;
        const { x: ox, y: oy } = offsetRef.current;
        return { sx: vx * s + ox, sy: vy * s + oy };
    }, []);

    const screenToVirtual = useCallback((sx, sy) => {
        const s = scaleRef.current;
        const { x: ox, y: oy } = offsetRef.current;
        return { vx: (sx - ox) / s, vy: (sy - oy) / s };
    }, []);

    const virtualSizeToScreen = useCallback((sz) => sz * scaleRef.current * zoom, [zoom]);

    const getVirtualCoords = useCallback((e) => {
        const rect = overlayRef.current.getBoundingClientRect();
        // pointer events behave like mouse events, so clientX/Y is on the event itself
        const cx = e.clientX;
        const cy = e.clientY;

        // CSS transforms apply to the clientRect automatically, removing offset
        const sx = (cx - rect.left) / zoom;
        const sy = (cy - rect.top) / zoom;

        return screenToVirtual(sx, sy);
    }, [screenToVirtual, zoom]);

    // ===== Split mode: check if virtual coord is on user's side =====
    const isOnMySide = useCallback((vx) => {
        if (!splitMode) return true;
        const mid = VIRTUAL_W / 2;
        return splitSide === 'left' ? vx <= mid : vx >= mid;
    }, [splitMode, splitSide]);

    // ===== Drawing primitives =====
    const drawLineS = useCallback((x0, y0, x1, y1, col, sz, ctx) => {
        const c = ctx || ctxRef.current; if (!c) return;
        c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1);
        c.strokeStyle = col; c.lineWidth = sz; c.stroke();
    }, []);

    const drawDotS = useCallback((x, y, col, sz, ctx) => {
        const c = ctx || ctxRef.current; if (!c) return;
        c.beginPath(); c.arc(x, y, sz / 2, 0, Math.PI * 2);
        c.fillStyle = col; c.fill();
    }, []);

    const drawShapeS = useCallback((shape, x0, y0, x1, y1, col, sz, ctx) => {
        const c = ctx || ctxRef.current; if (!c) return;
        c.strokeStyle = col; c.lineWidth = sz;
        if (shape === 'rect') {
            c.strokeRect(x0, y0, x1 - x0, y1 - y0);
        } else if (shape === 'circle') {
            c.beginPath();
            c.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
            c.stroke();
        } else if (shape === 'line') {
            c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
        }
    }, []);

    // Virtual coord wrappers
    const drawLineV = useCallback((vx0, vy0, vx1, vy1, col, sz, ctx) => {
        const { sx: x0, sy: y0 } = virtualToScreen(vx0, vy0);
        const { sx: x1, sy: y1 } = virtualToScreen(vx1, vy1);
        drawLineS(x0, y0, x1, y1, col, virtualSizeToScreen(sz) / zoom, ctx);
    }, [virtualToScreen, virtualSizeToScreen, drawLineS, zoom]);

    const drawDotV = useCallback((vx, vy, col, sz, ctx) => {
        const { sx, sy } = virtualToScreen(vx, vy);
        drawDotS(sx, sy, col, virtualSizeToScreen(sz) / zoom, ctx);
    }, [virtualToScreen, virtualSizeToScreen, drawDotS, zoom]);

    const drawShapeV = useCallback((shape, vx0, vy0, vx1, vy1, col, sz, ctx) => {
        const { sx: x0, sy: y0 } = virtualToScreen(vx0, vy0);
        const { sx: x1, sy: y1 } = virtualToScreen(vx1, vy1);
        drawShapeS(shape, x0, y0, x1, y1, col, virtualSizeToScreen(sz) / zoom, ctx);
    }, [virtualToScreen, virtualSizeToScreen, drawShapeS, zoom]);

    // ===== Flood Fill on Canvas =====
    const performFill = useCallback((vx, vy, fillColor, ctx) => {
        const c = ctx || ctxRef.current;
        const canvas = canvasRef.current;
        if (!c || !canvas) return;

        const { sx, sy } = virtualToScreen(vx, vy);
        const dpr = dprRef.current;
        const rawX = Math.floor(sx * dpr);
        const rawY = Math.floor(sy * dpr);

        // Temporarily reset transform to work with raw pixels
        c.save();
        c.setTransform(1, 0, 0, 1, 0, 0);
        const imageData = c.getImageData(0, 0, canvas.width, canvas.height);
        const fillRgba = hexToRgba(fillColor);
        const filled = scanlineFill(imageData, rawX, rawY, fillRgba);
        if (filled) {
            c.putImageData(imageData, 0, 0);
        }
        c.restore();
        // Restore transform
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
    }, [virtualToScreen]);

    // ===== Replay a single action =====
    const replayAction = useCallback((action, ctx) => {
        if (action.type === 'stroke') {
            action.points.forEach((pt) => {
                if (pt.type === 'start') drawDotV(pt.x, pt.y, pt.color, pt.size, ctx);
                else if (pt.type === 'draw') drawLineV(pt.px, pt.py, pt.x, pt.y, pt.color, pt.size, ctx);
            });
        } else if (action.type === 'shape') {
            drawShapeV(action.shape, action.x0, action.y0, action.x1, action.y1, action.color, action.size, ctx);
        } else if (action.type === 'fill') {
            performFill(action.x, action.y, action.color, ctx);
        }
    }, [drawDotV, drawLineV, drawShapeV, performFill]);

    // ===== Full Redraw =====
    const redrawAll = useCallback(() => {
        const ctx = ctxRef.current;
        if (!ctx) return;
        const { w, h } = displaySize.current;
        const s = scaleRef.current;
        const { x: ox, y: oy } = offsetRef.current;

        ctx.fillStyle = '#111122';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(ox, oy, VIRTUAL_W * s, VIRTUAL_H * s);

        const currentLayers = layersRef.current;
        actionsRef.current.forEach((action) => {
            const layer = currentLayers.find((l) => l.id === action.layerId);
            if (layer && !layer.visible) return;
            replayAction(action, ctx);
        });
    }, [replayAction]);

    useEffect(() => { redrawAll(); }, [layers, redrawAll]);

    // ===== Sync History on Mount =====
    useEffect(() => {
        const handleInitHistory = (history) => {
            actionsRef.current = history;
            redoStackRef.current = [];
            redrawAll();
        };
        socket.on('init-history', handleInitHistory);
        return () => socket.off('init-history', handleInitHistory);
    }, [socket, redrawAll]);

    // ===== Draw split line on overlay =====
    useEffect(() => {
        const oCtx = overlayCtxRef.current;
        if (!oCtx) return;
        const { w, h } = displaySize.current;
        oCtx.clearRect(0, 0, w, h);

        if (splitMode) {
            const { sx: midX, sy: topY } = virtualToScreen(VIRTUAL_W / 2, 0);
            const { sy: botY } = virtualToScreen(0, VIRTUAL_H);

            oCtx.save();
            oCtx.setLineDash([8, 6]);
            oCtx.beginPath();
            oCtx.moveTo(midX, topY);
            oCtx.lineTo(midX, botY);
            oCtx.strokeStyle = 'rgba(124, 92, 252, 0.6)';
            oCtx.lineWidth = 2;
            oCtx.stroke();
            oCtx.setLineDash([]);

            // Labels
            oCtx.font = '600 12px Inter, sans-serif';
            oCtx.textAlign = 'center';
            oCtx.fillStyle = splitSide === 'left' ? 'rgba(124, 92, 252, 0.8)' : 'rgba(255,255,255,0.25)';
            oCtx.fillText('YOU', midX - 60, topY + 20);
            oCtx.fillStyle = splitSide === 'right' ? 'rgba(124, 92, 252, 0.8)' : 'rgba(255,255,255,0.25)';
            oCtx.fillText('YOU', midX + 60, topY + 20);
            oCtx.restore();
        }
    }, [splitMode, splitSide, virtualToScreen]);

    // ===== Clear overlay & flush =====
    const clearOverlay = useCallback(() => {
        const oCtx = overlayCtxRef.current;
        if (!oCtx) return;
        const { w, h } = displaySize.current;
        oCtx.clearRect(0, 0, w, h);
    }, []);

    const flushBuffer = useCallback(() => {
        if (pointBuffer.current.length > 0) {
            socket.emit('draw-batch', pointBuffer.current);
            pointBuffer.current = [];
        }
    }, [socket]);

    // ===== Mouse/Touch/Pointer Handlers =====
    const handleStart = useCallback((e) => {
        if (tool === 'hand') return;
        if (penOnly && e.pointerType === 'touch') return;

        e.preventDefault();
        const { vx, vy } = getVirtualCoords(e);

        // Split mode check
        if (!isOnMySide(vx)) return;

        if (isFillTool) {
            // Flood fill
            performFill(vx, vy, color);
            const action = { type: 'fill', x: vx, y: vy, color, layerId: activeLayerId, isLocal: true };
            actionsRef.current.push(action);
            redoStackRef.current = [];
            socket.emit('draw', { type: 'fill', x: vx, y: vy, color, layerId: activeLayerId });
            return;
        }

        isDrawing.current = true;

        if (isShapeTool) {
            shapeStart.current = { vx, vy };
        } else {
            lastPoint.current = { vx, vy };
            const cc = tool === 'eraser' ? '#1a1a2e' : color;
            const cs = tool === 'eraser' ? brushSize * 3 : brushSize;

            currentStrokeRef.current = {
                type: 'stroke', layerId: activeLayerId, isLocal: true,
                points: [{ x: vx, y: vy, color: cc, size: cs, type: 'start' }],
            };

            drawDotV(vx, vy, cc, cs);
            socket.emit('draw', { x: vx, y: vy, color: cc, size: cs, type: 'start', layerId: activeLayerId });
        }
    }, [color, brushSize, tool, socket, isShapeTool, isFillTool, getVirtualCoords, drawDotV, activeLayerId, isOnMySide, performFill]);

    const handleMove = useCallback((e) => {
        if (tool === 'hand') return;
        if (penOnly && e.pointerType === 'touch') return;
        e.preventDefault();
        if (!isDrawing.current) return;
        const { vx, vy } = getVirtualCoords(e);

        if (isShapeTool) {
            clearOverlay();
            const start = shapeStart.current;
            if (start) drawShapeV(tool, start.vx, start.vy, vx, vy, color, brushSize, overlayCtxRef.current);
            // Redraw split line on overlay
            if (splitMode) {
                const oCtx = overlayCtxRef.current;
                const { sx: midX, sy: topY } = virtualToScreen(VIRTUAL_W / 2, 0);
                const { sy: botY } = virtualToScreen(0, VIRTUAL_H);
                oCtx.save();
                oCtx.setLineDash([8, 6]);
                oCtx.beginPath(); oCtx.moveTo(midX, topY); oCtx.lineTo(midX, botY);
                oCtx.strokeStyle = 'rgba(124, 92, 252, 0.6)'; oCtx.lineWidth = 2; oCtx.stroke();
                oCtx.setLineDash([]);
                oCtx.restore();
            }
        } else {
            // Clamp to split side
            let clampedVx = vx;
            if (splitMode) {
                const mid = VIRTUAL_W / 2;
                if (splitSide === 'left') clampedVx = Math.min(vx, mid);
                else clampedVx = Math.max(vx, mid);
            }

            const prev = lastPoint.current;
            const cc = tool === 'eraser' ? '#1a1a2e' : color;
            const cs = tool === 'eraser' ? brushSize * 3 : brushSize;

            drawLineV(prev.vx, prev.vy, clampedVx, vy, cc, cs);
            lastPoint.current = { vx: clampedVx, vy };

            if (currentStrokeRef.current) {
                currentStrokeRef.current.points.push({
                    x: clampedVx, y: vy, px: prev.vx, py: prev.vy,
                    color: cc, size: cs, type: 'draw',
                });
            }

            const now = Date.now();
            pointBuffer.current.push({
                x: clampedVx, y: vy, px: prev.vx, py: prev.vy,
                color: cc, size: cs, type: 'draw', layerId: activeLayerId,
            });

            if (now - lastEmitTime.current >= THROTTLE_MS) {
                flushBuffer(); lastEmitTime.current = now;
            } else {
                clearTimeout(throttleTimer.current);
                throttleTimer.current = setTimeout(() => { flushBuffer(); lastEmitTime.current = Date.now(); }, THROTTLE_MS);
            }
        }
    }, [color, brushSize, tool, isShapeTool, getVirtualCoords, drawLineV, drawShapeV, clearOverlay, flushBuffer, activeLayerId, splitMode, splitSide, virtualToScreen]);

    const handleEnd = useCallback((e) => {
        if (tool === 'hand') return;
        if (penOnly && e.pointerType === 'touch') return;
        e.preventDefault();
        if (!isDrawing.current) return;
        isDrawing.current = false;

        if (isShapeTool && shapeStart.current) {
            let vx, vy;
            // Native pointer events don't use changedTouches
            ({ vx, vy } = getVirtualCoords(e));
            const start = shapeStart.current;

            drawShapeV(tool, start.vx, start.vy, vx, vy, color, brushSize);
            clearOverlay();
            // Redraw split line
            if (splitMode) {
                const oCtx = overlayCtxRef.current;
                const { sx: midX, sy: topY } = virtualToScreen(VIRTUAL_W / 2, 0);
                const { sy: botY } = virtualToScreen(0, VIRTUAL_H);
                oCtx.save(); oCtx.setLineDash([8, 6]);
                oCtx.beginPath(); oCtx.moveTo(midX, topY); oCtx.lineTo(midX, botY);
                oCtx.strokeStyle = 'rgba(124, 92, 252, 0.6)'; oCtx.lineWidth = 2; oCtx.stroke();
                oCtx.setLineDash([]); oCtx.restore();
            }

            const action = {
                type: 'shape', shape: tool,
                x0: start.vx, y0: start.vy, x1: vx, y1: vy,
                color, size: brushSize, layerId: activeLayerId, isLocal: true,
            };
            actionsRef.current.push(action);
            redoStackRef.current = [];

            socket.emit('draw', {
                type: 'shape', shape: tool,
                x0: start.vx, y0: start.vy, x1: vx, y1: vy,
                color, size: brushSize, layerId: activeLayerId,
            });
            shapeStart.current = null;
        } else {
            flushBuffer();
            socket.emit('draw', { type: 'end', layerId: activeLayerId });
            if (currentStrokeRef.current && currentStrokeRef.current.points.length > 0) {
                actionsRef.current.push(currentStrokeRef.current);
                redoStackRef.current = [];
                currentStrokeRef.current = null;
            }
            lastPoint.current = null;
        }
    }, [tool, color, brushSize, isShapeTool, socket, screenToVirtual, getVirtualCoords, drawShapeV, clearOverlay, flushBuffer, activeLayerId, splitMode, virtualToScreen, zoom]);

    const handleLeave = useCallback((e) => {
        if (isShapeTool) return;
        handleEnd(e);
    }, [isShapeTool, handleEnd]);

    // ===== Remote Drawing Events =====
    useEffect(() => {
        const remoteLP = { current: null };

        const handleRemoteDraw = (data) => {
            const layer = layersRef.current.find((l) => l.id === data.layerId);
            const visible = !layer || layer.visible;

            if (data.type === 'start') {
                remoteLP.current = { vx: data.x, vy: data.y };
                remoteStrokeRef.current = {
                    type: 'stroke', layerId: data.layerId || 'layer-1', isLocal: false,
                    points: [{ x: data.x, y: data.y, color: data.color, size: data.size, type: 'start' }],
                };
                if (visible) drawDotV(data.x, data.y, data.color, data.size);
            } else if (data.type === 'draw') {
                const px = data.px ?? remoteLP.current?.vx ?? data.x;
                const py = data.py ?? remoteLP.current?.vy ?? data.y;
                if (remoteStrokeRef.current) {
                    remoteStrokeRef.current.points.push({ x: data.x, y: data.y, px, py, color: data.color, size: data.size, type: 'draw' });
                }
                remoteLP.current = { vx: data.x, vy: data.y };
                if (visible) drawLineV(px, py, data.x, data.y, data.color, data.size);
            } else if (data.type === 'shape') {
                const action = {
                    type: 'shape', shape: data.shape,
                    x0: data.x0, y0: data.y0, x1: data.x1, y1: data.y1,
                    color: data.color, size: data.size,
                    layerId: data.layerId || 'layer-1', isLocal: false,
                };
                actionsRef.current.push(action);
                if (visible) drawShapeV(data.shape, data.x0, data.y0, data.x1, data.y1, data.color, data.size);
            } else if (data.type === 'fill') {
                const action = { type: 'fill', x: data.x, y: data.y, color: data.color, layerId: data.layerId || 'layer-1', isLocal: false };
                actionsRef.current.push(action);
                if (visible) performFill(data.x, data.y, data.color);
            } else if (data.type === 'end') {
                if (remoteStrokeRef.current && remoteStrokeRef.current.points.length > 0) {
                    actionsRef.current.push(remoteStrokeRef.current);
                    remoteStrokeRef.current = null;
                }
                remoteLP.current = null;
            }
        };

        const handleRemoteBatch = (dataArray) => dataArray.forEach(handleRemoteDraw);
        const handleClear = () => { actionsRef.current = []; redoStackRef.current = []; redrawAll(); };

        socket.on('draw', handleRemoteDraw);
        socket.on('draw-batch', handleRemoteBatch);
        socket.on('clear', handleClear);

        return () => {
            socket.off('draw', handleRemoteDraw);
            socket.off('draw-batch', handleRemoteBatch);
            socket.off('clear', handleClear);
        };
    }, [socket, drawLineV, drawDotV, drawShapeV, performFill, redrawAll]);

    // ===== Undo / Redo / Clear =====
    const undo = useCallback(() => {
        const actions = actionsRef.current;
        for (let i = actions.length - 1; i >= 0; i--) {
            if (actions[i].isLocal) {
                redoStackRef.current.push(actions.splice(i, 1)[0]);
                redrawAll();
                return;
            }
        }
    }, [redrawAll]);

    const redo = useCallback(() => {
        if (redoStackRef.current.length === 0) return;
        actionsRef.current.push(redoStackRef.current.pop());
        redrawAll();
    }, [redrawAll]);

    const clearCanvas = useCallback(() => {
        actionsRef.current = [];
        redoStackRef.current = [];
        redrawAll();
    }, [redrawAll]);

    const deleteLayerActions = useCallback((layerId) => {
        actionsRef.current = actionsRef.current.filter((a) => a.layerId !== layerId);
        redoStackRef.current = redoStackRef.current.filter((a) => a.layerId !== layerId);
        redrawAll();
    }, [redrawAll]);

    useImperativeHandle(ref, () => ({ undo, redo, clearCanvas, deleteLayerActions }), [undo, redo, clearCanvas, deleteLayerActions]);

    return (
        <div className="canvas-wrapper" style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0'
        }}>
            <canvas ref={canvasRef} className="drawing-canvas" />
            <canvas
                ref={overlayRef}
                className={clsx("overlay-canvas", isFillTool && "fill-cursor", tool === 'hand' && "hand-cursor")}
                onPointerDown={handleStart}
                onPointerMove={handleMove}
                onPointerUp={handleEnd}
                onPointerCancel={handleEnd}
                onPointerLeave={handleLeave}
            />
        </div>
    );
});

Canvas.displayName = 'Canvas';
export default Canvas;
