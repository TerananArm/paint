import { useState } from 'react';

const PRESET_COLORS = [
    '#FF6B6B', '#FF8E53', '#FFC947', '#51CF66',
    '#20C997', '#339AF0', '#7950F2', '#E64980',
    '#FFFFFF', '#ADB5BD', '#868E96', '#212529',
];

export default function Toolbar({
    color, setColor, brushSize, setBrushSize,
    tool, setTool, onClear, onUndo, onRedo,
    isConnected, userCount,
    layers, activeLayerId, setActiveLayerId,
    addLayer, deleteLayer, toggleLayerVisibility,
}) {
    const [showCustomColor, setShowCustomColor] = useState(false);

    return (
        <div className="toolbar">
            {/* Connection Status */}
            <div className="toolbar-section">
                <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
                    <span className="status-dot" />
                    <span className="status-text">
                        {isConnected ? 'Connected' : 'Disconnected'}
                    </span>
                </div>
                {isConnected && (
                    <div className="user-count">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                        <span>{userCount} online</span>
                    </div>
                )}
            </div>

            {/* Undo / Redo */}
            <div className="toolbar-section">
                <div className="tool-buttons">
                    <button className="tool-btn" onClick={onUndo} title="Undo (Ctrl+Z)">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="1 4 1 10 7 10" />
                            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                        </svg>
                    </button>
                    <button className="tool-btn" onClick={onRedo} title="Redo (Ctrl+Shift+Z)">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 4 23 10 17 10" />
                            <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Draw Tools */}
            <div className="toolbar-section">
                <label className="section-label">Draw</label>
                <div className="tool-buttons">
                    <button className={`tool-btn ${tool === 'brush' ? 'active' : ''}`} onClick={() => setTool('brush')} title="Brush">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 19l7-7 3 3-7 7-3-3z" />
                            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                            <path d="M2 2l7.586 7.586" />
                            <circle cx="11" cy="11" r="2" />
                        </svg>
                    </button>
                    <button className={`tool-btn ${tool === 'eraser' ? 'active' : ''}`} onClick={() => setTool('eraser')} title="Eraser">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L14.8 1.4c.8-.8 2-.8 2.8 0L21.2 5c.8.8.8 2 0 2.8L12 17" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Shapes */}
            <div className="toolbar-section">
                <label className="section-label">Shapes</label>
                <div className="tool-buttons">
                    <button className={`tool-btn ${tool === 'rect' ? 'active' : ''}`} onClick={() => setTool('rect')} title="Rectangle">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
                    </button>
                    <button className={`tool-btn ${tool === 'circle' ? 'active' : ''}`} onClick={() => setTool('circle')} title="Circle">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /></svg>
                    </button>
                    <button className={`tool-btn ${tool === 'line' ? 'active' : ''}`} onClick={() => setTool('line')} title="Line">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="19" x2="19" y2="5" /></svg>
                    </button>
                </div>
            </div>

            {/* Colors */}
            <div className="toolbar-section">
                <label className="section-label">Colors</label>
                <div className="color-grid">
                    {PRESET_COLORS.map((c) => (
                        <button
                            key={c}
                            className={`color-swatch ${color === c && tool !== 'eraser' ? 'active' : ''}`}
                            style={{ backgroundColor: c }}
                            onClick={() => { setColor(c); setTool('brush'); }}
                            title={c}
                        />
                    ))}
                </div>
                <div className="custom-color-row">
                    <button className="custom-color-btn" onClick={() => setShowCustomColor(!showCustomColor)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
                        </svg>
                        Custom
                    </button>
                    {showCustomColor && (
                        <input type="color" value={color} onChange={(e) => { setColor(e.target.value); setTool('brush'); }} className="color-picker-input" />
                    )}
                </div>
            </div>

            {/* Brush Size */}
            <div className="toolbar-section">
                <label className="section-label">Size: {brushSize}px</label>
                <input type="range" min="1" max="50" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} className="size-slider" />
                <div className="size-preview-wrapper">
                    <div className="size-preview" style={{ width: Math.min(brushSize, 40), height: Math.min(brushSize, 40), backgroundColor: tool === 'eraser' ? '#555' : color }} />
                </div>
            </div>

            {/* Layers */}
            <div className="toolbar-section layers-section">
                <div className="layers-header">
                    <label className="section-label" style={{ marginBottom: 0 }}>Layers</label>
                    <button className="layer-add-btn" onClick={addLayer} title="Add Layer">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                    </button>
                </div>
                <div className="layer-list">
                    {[...layers].reverse().map((layer) => (
                        <div
                            key={layer.id}
                            className={`layer-item ${activeLayerId === layer.id ? 'active' : ''}`}
                            onClick={() => setActiveLayerId(layer.id)}
                        >
                            <button
                                className={`layer-visibility ${layer.visible ? 'visible' : 'hidden'}`}
                                onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
                                title={layer.visible ? 'Hide layer' : 'Show layer'}
                            >
                                {layer.visible ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                                    </svg>
                                ) : (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                                        <line x1="1" y1="1" x2="23" y2="23" />
                                    </svg>
                                )}
                            </button>
                            <span className="layer-name">{layer.name}</span>
                            {layers.length > 1 && (
                                <button
                                    className="layer-delete-btn"
                                    onClick={(e) => { e.stopPropagation(); deleteLayer(layer.id); }}
                                    title="Delete layer"
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Clear Canvas */}
            <div className="toolbar-section">
                <button className="clear-btn" onClick={onClear}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    Clear Canvas
                </button>
            </div>

            {/* Branding */}
            <div className="toolbar-brand">
                <span className="brand-icon">🎨</span>
                <span className="brand-text">Piant</span>
            </div>
        </div>
    );
}
