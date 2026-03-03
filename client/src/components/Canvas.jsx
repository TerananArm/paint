import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';

const THROTTLE_MS = 16;
const VIRTUAL_W = 1920;
const VIRTUAL_H = 1080;

const Canvas = forwardRef(({ color, brushSize, tool, socket, layers, activeLayerId }, ref) => {
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

    // Action-based history
    const actionsRef = useRef([]);
    const redoStackRef = useRef([]);
    const currentStrokeRef = useRef(null);
    const remoteStrokeRef = useRef(null);
    const layersRef = useRef(layers);

    // Keep layersRef in sync
    useEffect(() => {
        layersRef.current = layers;
    }, [layers]);

    const isShapeTool = ['rect', 'circle', 'line'].includes(tool);

    // ===== Canvas Setup =====
    const calcFit = useCallback((containerW, containerH) => {
        const scaleX = containerW / VIRTUAL_W;
        const scaleY = containerH / VIRTUAL_H;
        const scale = Math.min(scaleX, scaleY);
        const offsetX = (containerW - VIRTUAL_W * scale) / 2;
        const offsetY = (containerH - VIRTUAL_H * scale) / 2;
        return { scale, offsetX, offsetY };
    }, []);

    useEffect(() => {
        const setupCanvas = () => {
            const canvas = canvasRef.current;
            const overlay = overlayRef.current;
            const parent = canvas.parentElement;
            const w = parent.clientWidth;
            const h = parent.clientHeight;
            const dpr = window.devicePixelRatio || 1;

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

        const handleResize = () => {
            setupCanvas();
            redrawAll();
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [calcFit]);

    // ===== Coordinate Conversion =====
    const virtualToScreen = useCallback((vx, vy) => {
        const scale = scaleRef.current;
        const { x: ox, y: oy } = offsetRef.current;
        return { sx: vx * scale + ox, sy: vy * scale + oy };
    }, []);

    const screenToVirtual = useCallback((sx, sy) => {
        const scale = scaleRef.current;
        const { x: ox, y: oy } = offsetRef.current;
        return { vx: (sx - ox) / scale, vy: (sy - oy) / scale };
    }, []);

    const virtualSizeToScreen = useCallback((size) => size * scaleRef.current, []);

    const getVirtualCoords = useCallback((e) => {
        const rect = overlayRef.current.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return screenToVirtual(clientX - rect.left, clientY - rect.top);
    }, [screenToVirtual]);

    // ===== Low-level Drawing (screen coords) =====
    const drawLineScreen = useCallback((x0, y0, x1, y1, strokeColor, strokeSize, ctx) => {
        const c = ctx || ctxRef.current;
        if (!c) return;
        c.beginPath();
        c.moveTo(x0, y0);
        c.lineTo(x1, y1);
        c.strokeStyle = strokeColor;
        c.lineWidth = strokeSize;
        c.stroke();
    }, []);

    const drawDotScreen = useCallback((x, y, strokeColor, strokeSize, ctx) => {
        const c = ctx || ctxRef.current;
        if (!c) return;
        c.beginPath();
        c.arc(x, y, strokeSize / 2, 0, Math.PI * 2);
        c.fillStyle = strokeColor;
        c.fill();
    }, []);

    const drawShapeScreen = useCallback((shape, x0, y0, x1, y1, strokeColor, strokeSize, ctx) => {
        const c = ctx || ctxRef.current;
        if (!c) return;
        c.strokeStyle = strokeColor;
        c.lineWidth = strokeSize;
        if (shape === 'rect') {
            c.strokeRect(x0, y0, x1 - x0, y1 - y0);
        } else if (shape === 'circle') {
            c.beginPath();
            const rx = Math.abs(x1 - x0) / 2;
            const ry = Math.abs(y1 - y0) / 2;
            c.ellipse((x0 + x1) / 2, (y0 + y1) / 2, rx, ry, 0, 0, Math.PI * 2);
            c.stroke();
        } else if (shape === 'line') {
            c.beginPath();
            c.moveTo(x0, y0);
            c.lineTo(x1, y1);
            c.stroke();
        }
    }, []);

    // ===== Virtual coord drawing =====
    const drawLineV = useCallback((vx0, vy0, vx1, vy1, col, sz, ctx) => {
        const { sx: x0, sy: y0 } = virtualToScreen(vx0, vy0);
        const { sx: x1, sy: y1 } = virtualToScreen(vx1, vy1);
        drawLineScreen(x0, y0, x1, y1, col, virtualSizeToScreen(sz), ctx);
    }, [virtualToScreen, virtualSizeToScreen, drawLineScreen]);

    const drawDotV = useCallback((vx, vy, col, sz, ctx) => {
        const { sx, sy } = virtualToScreen(vx, vy);
        drawDotScreen(sx, sy, col, virtualSizeToScreen(sz), ctx);
    }, [virtualToScreen, virtualSizeToScreen, drawDotScreen]);

    const drawShapeV = useCallback((shape, vx0, vy0, vx1, vy1, col, sz, ctx) => {
        const { sx: x0, sy: y0 } = virtualToScreen(vx0, vy0);
        const { sx: x1, sy: y1 } = virtualToScreen(vx1, vy1);
        drawShapeScreen(shape, x0, y0, x1, y1, col, virtualSizeToScreen(sz), ctx);
    }, [virtualToScreen, virtualSizeToScreen, drawShapeScreen]);

    // ===== Replay a single action on canvas =====
    const replayAction = useCallback((action, ctx) => {
        if (action.type === 'stroke') {
            action.points.forEach((pt) => {
                if (pt.type === 'start') {
                    drawDotV(pt.x, pt.y, pt.color, pt.size, ctx);
                } else if (pt.type === 'draw') {
                    drawLineV(pt.px, pt.py, pt.x, pt.y, pt.color, pt.size, ctx);
                }
            });
        } else if (action.type === 'shape') {
            drawShapeV(action.shape, action.x0, action.y0, action.x1, action.y1, action.color, action.size, ctx);
        }
    }, [drawDotV, drawLineV, drawShapeV]);

    // ===== Full Redraw =====
    const redrawAll = useCallback(() => {
        const ctx = ctxRef.current;
        if (!ctx) return;
        const { w, h } = displaySize.current;
        const scale = scaleRef.current;
        const { x: ox, y: oy } = offsetRef.current;

        // Clear entire canvas
        ctx.fillStyle = '#111122';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(ox, oy, VIRTUAL_W * scale, VIRTUAL_H * scale);

        // Replay all visible actions
        const currentLayers = layersRef.current;
        actionsRef.current.forEach((action) => {
            const layer = currentLayers.find((l) => l.id === action.layerId);
            if (layer && !layer.visible) return;
            replayAction(action, ctx);
        });
    }, [replayAction]);

    // Redraw when layers change (visibility toggle)
    useEffect(() => {
        redrawAll();
    }, [layers, redrawAll]);

    // ===== Clear overlay =====
    const clearOverlay = useCallback(() => {
        const oCtx = overlayCtxRef.current;
        if (!oCtx) return;
        const { w, h } = displaySize.current;
        oCtx.clearRect(0, 0, w, h);
    }, []);

    // ===== Throttle flush =====
    const flushBuffer = useCallback(() => {
        if (pointBuffer.current.length > 0) {
            socket.emit('draw-batch', pointBuffer.current);
            pointBuffer.current = [];
        }
    }, [socket]);

    // ===== Mouse/Touch Handlers =====
    const handleStart = useCallback((e) => {
        e.preventDefault();
        isDrawing.current = true;
        const { vx, vy } = getVirtualCoords(e);

        if (isShapeTool) {
            shapeStart.current = { vx, vy };
        } else {
            lastPoint.current = { vx, vy };
            const currentColor = tool === 'eraser' ? '#1a1a2e' : color;
            const currentSize = tool === 'eraser' ? brushSize * 3 : brushSize;

            // Start new stroke action
            currentStrokeRef.current = {
                type: 'stroke',
                layerId: activeLayerId,
                isLocal: true,
                points: [{ x: vx, y: vy, color: currentColor, size: currentSize, type: 'start' }],
            };

            drawDotV(vx, vy, currentColor, currentSize);
            socket.emit('draw', {
                x: vx, y: vy, color: currentColor, size: currentSize,
                type: 'start', layerId: activeLayerId,
            });
        }
    }, [color, brushSize, tool, socket, isShapeTool, getVirtualCoords, drawDotV, activeLayerId]);

    const handleMove = useCallback((e) => {
        e.preventDefault();
        if (!isDrawing.current) return;
        const { vx, vy } = getVirtualCoords(e);

        if (isShapeTool) {
            clearOverlay();
            const start = shapeStart.current;
            if (start) {
                drawShapeV(tool, start.vx, start.vy, vx, vy, color, brushSize, overlayCtxRef.current);
            }
        } else {
            const prev = lastPoint.current;
            const currentColor = tool === 'eraser' ? '#1a1a2e' : color;
            const currentSize = tool === 'eraser' ? brushSize * 3 : brushSize;

            drawLineV(prev.vx, prev.vy, vx, vy, currentColor, currentSize);
            lastPoint.current = { vx, vy };

            // Add point to current stroke
            if (currentStrokeRef.current) {
                currentStrokeRef.current.points.push({
                    x: vx, y: vy, px: prev.vx, py: prev.vy,
                    color: currentColor, size: currentSize, type: 'draw',
                });
            }

            // Throttle socket
            const now = Date.now();
            const point = {
                x: vx, y: vy, px: prev.vx, py: prev.vy,
                color: currentColor, size: currentSize, type: 'draw',
                layerId: activeLayerId,
            };
            pointBuffer.current.push(point);

            if (now - lastEmitTime.current >= THROTTLE_MS) {
                flushBuffer();
                lastEmitTime.current = now;
            } else {
                clearTimeout(throttleTimer.current);
                throttleTimer.current = setTimeout(() => {
                    flushBuffer();
                    lastEmitTime.current = Date.now();
                }, THROTTLE_MS);
            }
        }
    }, [color, brushSize, tool, isShapeTool, getVirtualCoords, drawLineV, drawShapeV, clearOverlay, flushBuffer, activeLayerId]);

    const handleEnd = useCallback((e) => {
        e.preventDefault();
        if (!isDrawing.current) return;
        isDrawing.current = false;

        if (isShapeTool && shapeStart.current) {
            let vx, vy;
            if (e.changedTouches) {
                const rect = overlayRef.current.getBoundingClientRect();
                ({ vx, vy } = screenToVirtual(
                    e.changedTouches[0].clientX - rect.left,
                    e.changedTouches[0].clientY - rect.top
                ));
            } else {
                ({ vx, vy } = getVirtualCoords(e));
            }
            const start = shapeStart.current;

            drawShapeV(tool, start.vx, start.vy, vx, vy, color, brushSize);
            clearOverlay();

            const action = {
                type: 'shape', shape: tool,
                x0: start.vx, y0: start.vy, x1: vx, y1: vy,
                color, size: brushSize,
                layerId: activeLayerId, isLocal: true,
            };
            actionsRef.current.push(action);
            redoStackRef.current = []; // clear redo on new action

            socket.emit('draw', {
                type: 'shape', shape: tool,
                x0: start.vx, y0: start.vy, x1: vx, y1: vy,
                color, size: brushSize, layerId: activeLayerId,
            });

            shapeStart.current = null;
        } else {
            flushBuffer();
            socket.emit('draw', { type: 'end', layerId: activeLayerId });

            // Finalize current stroke as action
            if (currentStrokeRef.current && currentStrokeRef.current.points.length > 0) {
                actionsRef.current.push(currentStrokeRef.current);
                redoStackRef.current = [];
                currentStrokeRef.current = null;
            }
            lastPoint.current = null;
        }
    }, [tool, color, brushSize, isShapeTool, socket, screenToVirtual, getVirtualCoords, drawShapeV, clearOverlay, flushBuffer, activeLayerId]);

    const handleLeave = useCallback((e) => {
        if (isShapeTool) return;
        handleEnd(e);
    }, [isShapeTool, handleEnd]);

    // ===== Remote Drawing Events =====
    useEffect(() => {
        const remoteLP = { current: null };

        const handleRemoteDraw = (data) => {
            // Check if the layer is visible
            const layer = layersRef.current.find((l) => l.id === data.layerId);
            const visible = !layer || layer.visible; // if layer not found, still draw

            if (data.type === 'start') {
                remoteLP.current = { vx: data.x, vy: data.y };
                remoteStrokeRef.current = {
                    type: 'stroke', layerId: data.layerId || 'layer-1',
                    isLocal: false,
                    points: [{ x: data.x, y: data.y, color: data.color, size: data.size, type: 'start' }],
                };
                if (visible) drawDotV(data.x, data.y, data.color, data.size);
            } else if (data.type === 'draw') {
                const px = data.px ?? remoteLP.current?.vx ?? data.x;
                const py = data.py ?? remoteLP.current?.vy ?? data.y;
                if (remoteStrokeRef.current) {
                    remoteStrokeRef.current.points.push({
                        x: data.x, y: data.y, px, py,
                        color: data.color, size: data.size, type: 'draw',
                    });
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
            } else if (data.type === 'end') {
                if (remoteStrokeRef.current && remoteStrokeRef.current.points.length > 0) {
                    actionsRef.current.push(remoteStrokeRef.current);
                    remoteStrokeRef.current = null;
                }
                remoteLP.current = null;
            }
        };

        const handleRemoteBatch = (dataArray) => {
            dataArray.forEach(handleRemoteDraw);
        };

        const handleClear = () => {
            actionsRef.current = [];
            redoStackRef.current = [];
            redrawAll();
        };

        socket.on('draw', handleRemoteDraw);
        socket.on('draw-batch', handleRemoteBatch);
        socket.on('clear', handleClear);

        return () => {
            socket.off('draw', handleRemoteDraw);
            socket.off('draw-batch', handleRemoteBatch);
            socket.off('clear', handleClear);
        };
    }, [socket, drawLineV, drawDotV, drawShapeV, redrawAll]);

    // ===== Undo / Redo / Clear =====
    const undo = useCallback(() => {
        const actions = actionsRef.current;
        for (let i = actions.length - 1; i >= 0; i--) {
            if (actions[i].isLocal) {
                const removed = actions.splice(i, 1)[0];
                redoStackRef.current.push(removed);
                redrawAll();
                return;
            }
        }
    }, [redrawAll]);

    const redo = useCallback(() => {
        if (redoStackRef.current.length === 0) return;
        const action = redoStackRef.current.pop();
        actionsRef.current.push(action);
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

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
        undo, redo, clearCanvas, deleteLayerActions,
    }), [undo, redo, clearCanvas, deleteLayerActions]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
            } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
                e.preventDefault();
                redo();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo]);

    return (
        <div className="canvas-wrapper">
            <canvas ref={canvasRef} className="drawing-canvas" />
            <canvas
                ref={overlayRef}
                className="overlay-canvas"
                onMouseDown={handleStart}
                onMouseMove={handleMove}
                onMouseUp={handleEnd}
                onMouseLeave={handleLeave}
                onTouchStart={handleStart}
                onTouchMove={handleMove}
                onTouchEnd={handleEnd}
            />
        </div>
    );
});

Canvas.displayName = 'Canvas';
export default Canvas;
