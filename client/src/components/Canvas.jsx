import { useRef, useEffect, useCallback } from 'react';

const THROTTLE_MS = 16; // ~60fps throttling
// Fixed virtual canvas dimensions — all users share this coordinate space
const VIRTUAL_W = 1920;
const VIRTUAL_H = 1080;

export default function Canvas({ color, brushSize, tool, socket }) {
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

    const isShapeTool = ['rect', 'circle', 'line'].includes(tool);

    // Calculate scale & offset to fit virtual canvas into container (letterboxed)
    const calcFit = useCallback((containerW, containerH) => {
        const scaleX = containerW / VIRTUAL_W;
        const scaleY = containerH / VIRTUAL_H;
        const scale = Math.min(scaleX, scaleY);
        const offsetX = (containerW - VIRTUAL_W * scale) / 2;
        const offsetY = (containerH - VIRTUAL_H * scale) / 2;
        return { scale, offsetX, offsetY };
    }, []);

    // Initialize canvas
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

            // Set both canvases to fill container
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

            // Fill letterbox bars with dark bg
            ctx.fillStyle = '#111122';
            ctx.fillRect(0, 0, w, h);
            // Fill virtual canvas area
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
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            setupCanvas();
            // Note: old image data won't perfectly match new scale,
            // but for a live session this is acceptable
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [calcFit]);

    // Convert screen coords → virtual coords (0 to VIRTUAL_W/H)
    const screenToVirtual = useCallback((sx, sy) => {
        const scale = scaleRef.current;
        const { x: ox, y: oy } = offsetRef.current;
        return {
            vx: (sx - ox) / scale,
            vy: (sy - oy) / scale,
        };
    }, []);

    // Convert virtual coords → screen coords
    const virtualToScreen = useCallback((vx, vy) => {
        const scale = scaleRef.current;
        const { x: ox, y: oy } = offsetRef.current;
        return {
            sx: vx * scale + ox,
            sy: vy * scale + oy,
        };
    }, []);

    // Scale a size value from virtual to screen
    const virtualSizeToScreen = useCallback((size) => {
        return size * scaleRef.current;
    }, []);

    // Draw a line segment in screen coordinates
    const drawLineScreen = useCallback((x0, y0, x1, y1, strokeColor, strokeSize, ctx) => {
        const c = ctx || ctxRef.current;
        if (!c) return;
        c.beginPath();
        c.moveTo(x0, y0);
        c.lineTo(x1, y1);
        c.strokeStyle = strokeColor;
        c.lineWidth = strokeSize;
        c.stroke();
        c.closePath();
    }, []);

    // Draw a dot in screen coordinates
    const drawDotScreen = useCallback((x, y, strokeColor, strokeSize, ctx) => {
        const c = ctx || ctxRef.current;
        if (!c) return;
        c.beginPath();
        c.arc(x, y, strokeSize / 2, 0, Math.PI * 2);
        c.fillStyle = strokeColor;
        c.fill();
        c.closePath();
    }, []);

    // Draw using virtual coordinates (converts to screen internally)
    const drawLineVirtual = useCallback((vx0, vy0, vx1, vy1, strokeColor, virtualSize, ctx) => {
        const { sx: sx0, sy: sy0 } = virtualToScreen(vx0, vy0);
        const { sx: sx1, sy: sy1 } = virtualToScreen(vx1, vy1);
        drawLineScreen(sx0, sy0, sx1, sy1, strokeColor, virtualSizeToScreen(virtualSize), ctx);
    }, [virtualToScreen, virtualSizeToScreen, drawLineScreen]);

    const drawDotVirtual = useCallback((vx, vy, strokeColor, virtualSize, ctx) => {
        const { sx, sy } = virtualToScreen(vx, vy);
        drawDotScreen(sx, sy, strokeColor, virtualSizeToScreen(virtualSize), ctx);
    }, [virtualToScreen, virtualSizeToScreen, drawDotScreen]);

    // Draw a shape in screen coordinates
    const drawShapeScreen = useCallback((shape, x0, y0, x1, y1, strokeColor, strokeSize, ctx) => {
        const c = ctx || ctxRef.current;
        if (!c) return;
        c.beginPath();
        c.strokeStyle = strokeColor;
        c.lineWidth = strokeSize;

        if (shape === 'rect') {
            c.strokeRect(x0, y0, x1 - x0, y1 - y0);
        } else if (shape === 'circle') {
            const rx = Math.abs(x1 - x0) / 2;
            const ry = Math.abs(y1 - y0) / 2;
            const cx = (x0 + x1) / 2;
            const cy = (y0 + y1) / 2;
            c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            c.stroke();
        } else if (shape === 'line') {
            c.moveTo(x0, y0);
            c.lineTo(x1, y1);
            c.stroke();
        }
        c.closePath();
    }, []);

    // Draw shape using virtual coordinates
    const drawShapeVirtual = useCallback((shape, vx0, vy0, vx1, vy1, strokeColor, virtualSize, ctx) => {
        const { sx: sx0, sy: sy0 } = virtualToScreen(vx0, vy0);
        const { sx: sx1, sy: sy1 } = virtualToScreen(vx1, vy1);
        drawShapeScreen(shape, sx0, sy0, sx1, sy1, strokeColor, virtualSizeToScreen(virtualSize), ctx);
    }, [virtualToScreen, virtualSizeToScreen, drawShapeScreen]);

    // Clear overlay
    const clearOverlay = useCallback(() => {
        const oCtx = overlayCtxRef.current;
        if (!oCtx) return;
        const { w, h } = displaySize.current;
        oCtx.clearRect(0, 0, w, h);
    }, []);

    // Flush buffered points via socket
    const flushBuffer = useCallback(() => {
        if (pointBuffer.current.length > 0) {
            socket.emit('draw-batch', pointBuffer.current);
            pointBuffer.current = [];
        }
    }, [socket]);

    // Get virtual coordinates from mouse/touch event
    const getVirtualCoords = useCallback((e) => {
        const canvas = overlayRef.current;
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const screenX = clientX - rect.left;
        const screenY = clientY - rect.top;
        return screenToVirtual(screenX, screenY);
    }, [screenToVirtual]);

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

            drawDotVirtual(vx, vy, currentColor, currentSize);
            socket.emit('draw', { x: vx, y: vy, color: currentColor, size: currentSize, type: 'start' });
        }
    }, [color, brushSize, tool, socket, isShapeTool, getVirtualCoords, drawDotVirtual]);

    const handleMove = useCallback((e) => {
        e.preventDefault();
        if (!isDrawing.current) return;

        const { vx, vy } = getVirtualCoords(e);

        if (isShapeTool) {
            clearOverlay();
            const start = shapeStart.current;
            if (start) {
                drawShapeVirtual(tool, start.vx, start.vy, vx, vy, color, brushSize, overlayCtxRef.current);
            }
        } else {
            const prev = lastPoint.current;
            const currentColor = tool === 'eraser' ? '#1a1a2e' : color;
            const currentSize = tool === 'eraser' ? brushSize * 3 : brushSize;

            // Draw locally immediately
            drawLineVirtual(prev.vx, prev.vy, vx, vy, currentColor, currentSize);
            lastPoint.current = { vx, vy };

            // Throttle socket emissions (send virtual coordinates)
            const now = Date.now();
            const point = { x: vx, y: vy, px: prev.vx, py: prev.vy, color: currentColor, size: currentSize, type: 'draw' };
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
    }, [color, brushSize, tool, isShapeTool, getVirtualCoords, drawLineVirtual, drawShapeVirtual, clearOverlay, flushBuffer]);

    const handleEnd = useCallback((e) => {
        e.preventDefault();
        if (!isDrawing.current) return;
        isDrawing.current = false;

        if (isShapeTool && shapeStart.current) {
            let vx, vy;
            if (e.changedTouches) {
                const rect = overlayRef.current.getBoundingClientRect();
                const sx = e.changedTouches[0].clientX - rect.left;
                const sy = e.changedTouches[0].clientY - rect.top;
                ({ vx, vy } = screenToVirtual(sx, sy));
            } else {
                ({ vx, vy } = getVirtualCoords(e));
            }
            const start = shapeStart.current;

            // Draw final shape on main canvas
            drawShapeVirtual(tool, start.vx, start.vy, vx, vy, color, brushSize);
            clearOverlay();

            // Emit shape event (virtual coordinates)
            socket.emit('draw', {
                type: 'shape',
                shape: tool,
                x0: start.vx, y0: start.vy,
                x1: vx, y1: vy,
                color, size: brushSize,
            });

            shapeStart.current = null;
        } else {
            flushBuffer();
            socket.emit('draw', { type: 'end' });
            lastPoint.current = null;
        }
    }, [tool, color, brushSize, isShapeTool, socket, screenToVirtual, getVirtualCoords, drawShapeVirtual, clearOverlay, flushBuffer]);

    const handleLeave = useCallback((e) => {
        if (isShapeTool) return;
        handleEnd(e);
    }, [isShapeTool, handleEnd]);

    // ===== Remote Drawing Events (all in virtual coordinates) =====
    useEffect(() => {
        const remoteLastPoint = { current: null };

        const handleRemoteDraw = (data) => {
            if (data.type === 'start') {
                remoteLastPoint.current = { vx: data.x, vy: data.y };
                drawDotVirtual(data.x, data.y, data.color, data.size);
            } else if (data.type === 'draw') {
                const px = data.px ?? remoteLastPoint.current?.vx ?? data.x;
                const py = data.py ?? remoteLastPoint.current?.vy ?? data.y;
                drawLineVirtual(px, py, data.x, data.y, data.color, data.size);
                remoteLastPoint.current = { vx: data.x, vy: data.y };
            } else if (data.type === 'shape') {
                drawShapeVirtual(data.shape, data.x0, data.y0, data.x1, data.y1, data.color, data.size);
            } else if (data.type === 'end') {
                remoteLastPoint.current = null;
            }
        };

        const handleRemoteBatch = (dataArray) => {
            dataArray.forEach(handleRemoteDraw);
        };

        const handleClear = () => {
            clearCanvas();
        };

        socket.on('draw', handleRemoteDraw);
        socket.on('draw-batch', handleRemoteBatch);
        socket.on('clear', handleClear);

        return () => {
            socket.off('draw', handleRemoteDraw);
            socket.off('draw-batch', handleRemoteBatch);
            socket.off('clear', handleClear);
        };
    }, [socket, drawLineVirtual, drawDotVirtual, drawShapeVirtual]);

    // Clear canvas
    const clearCanvas = useCallback(() => {
        const ctx = ctxRef.current;
        if (!ctx) return;
        const { w, h } = displaySize.current;
        const scale = scaleRef.current;
        const { x: ox, y: oy } = offsetRef.current;
        // Fill letterbox
        ctx.fillStyle = '#111122';
        ctx.fillRect(0, 0, w, h);
        // Fill virtual area
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(ox, oy, VIRTUAL_W * scale, VIRTUAL_H * scale);
    }, []);

    useEffect(() => {
        window.__clearCanvas = clearCanvas;
    }, [clearCanvas]);

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
}
