import { useState, useRef } from 'react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import { useSocket } from './hooks/useSocket';
import './App.css';

let layerIdCounter = 1;

function App() {
  const [color, setColor] = useState('#FF6B6B');
  const [brushSize, setBrushSize] = useState(4);
  const [tool, setTool] = useState('brush');
  const [layers, setLayers] = useState([
    { id: 'layer-1', name: 'Layer 1', visible: true },
  ]);
  const [activeLayerId, setActiveLayerId] = useState('layer-1');
  const [splitMode, setSplitMode] = useState(false);
  const [splitSide, setSplitSide] = useState('left');
  const [penOnly, setPenOnly] = useState(false);
  const { emit, on, off, isConnected, userCount } = useSocket();
  const canvasRef = useRef(null);

  const socket = { emit, on, off };

  const handleClear = () => {
    canvasRef.current?.clearCanvas();
    emit('clear');
  };

  const handleUndo = () => canvasRef.current?.undo();
  const handleRedo = () => canvasRef.current?.redo();

  const addLayer = () => {
    layerIdCounter++;
    const newLayer = {
      id: `layer-${layerIdCounter}`,
      name: `Layer ${layerIdCounter}`,
      visible: true,
    };
    setLayers((prev) => [...prev, newLayer]);
    setActiveLayerId(newLayer.id);
  };

  const deleteLayer = (id) => {
    if (layers.length <= 1) return;
    setLayers((prev) => prev.filter((l) => l.id !== id));
    if (activeLayerId === id) {
      setActiveLayerId(layers.find((l) => l.id !== id)?.id || layers[0].id);
    }
    canvasRef.current?.deleteLayerActions(id);
  };

  const toggleLayerVisibility = (id) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
    );
  };

  return (
    <div className="app">
      <Toolbar
        color={color}
        setColor={setColor}
        brushSize={brushSize}
        setBrushSize={setBrushSize}
        tool={tool}
        setTool={setTool}
        onClear={handleClear}
        onUndo={handleUndo}
        onRedo={handleRedo}
        isConnected={isConnected}
        userCount={userCount}
        layers={layers}
        activeLayerId={activeLayerId}
        setActiveLayerId={setActiveLayerId}
        addLayer={addLayer}
        deleteLayer={deleteLayer}
        toggleLayerVisibility={toggleLayerVisibility}
        splitMode={splitMode}
        setSplitMode={setSplitMode}
        splitSide={splitSide}
        setSplitSide={setSplitSide}
        penOnly={penOnly}
        setPenOnly={setPenOnly}
      />
      <div className="canvas-container">
        <Canvas
          ref={canvasRef}
          color={color}
          brushSize={brushSize}
          tool={tool}
          socket={socket}
          layers={layers}
          activeLayerId={activeLayerId}
          splitMode={splitMode}
          splitSide={splitSide}
          penOnly={penOnly}
        />
      </div>
    </div>
  );
}

export default App;
