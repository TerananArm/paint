import { useState } from 'react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import { useSocket } from './hooks/useSocket';
import './App.css';

function App() {
  const [color, setColor] = useState('#FF6B6B');
  const [brushSize, setBrushSize] = useState(4);
  const [tool, setTool] = useState('brush');
  const { emit, on, off, isConnected, userCount } = useSocket();

  const socket = { emit, on, off };

  const handleClear = () => {
    if (window.__clearCanvas) {
      window.__clearCanvas();
    }
    emit('clear');
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
        isConnected={isConnected}
        userCount={userCount}
      />
      <div className="canvas-container">
        <Canvas
          color={color}
          brushSize={brushSize}
          tool={tool}
          socket={socket}
        />
      </div>
    </div>
  );
}

export default App;
