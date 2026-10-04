import { useEffect, useRef, useState } from "react";

const palette = ["#172942", "#1769d1", "#d43d4d", "#198754", "#8d4ed6"];

function pointFor(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
}

function drawStroke(context, stroke, canvas) {
  context.save();
  context.globalCompositeOperation =
    stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.size;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(stroke.from.x * canvas.width, stroke.from.y * canvas.height);
  context.lineTo(stroke.to.x * canvas.width, stroke.to.y * canvas.height);
  context.stroke();
  context.restore();
}

export function Whiteboard({ socket, canManage, permissions = {} }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPoint = useRef(null);
  const [active, setActive] = useState(false);
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(palette[0]);
  const [size, setSize] = useState(4);
  const [notice, setNotice] = useState("");
  const clearCanvas = () => {
    const canvas = canvasRef.current;
    canvas?.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  };
  const render = (stroke) => {
    const canvas = canvasRef.current;
    if (canvas) drawStroke(canvas.getContext("2d"), stroke, canvas);
  };
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(bounds.width));
      canvas.height = Math.max(1, Math.floor(bounds.height));
      socket?.emit("whiteboard:request-sync");
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [active, socket]);
  useEffect(() => {
    if (!socket) return;
    const initial = ({ active: isActive, strokes }) => {
      setActive(Boolean(isActive));
      clearCanvas();
      strokes.forEach(render);
    };
    const created = ({ strokes }) => {
      setActive(true);
      clearCanvas();
      strokes.forEach(render);
    };
    const stroke = (item) => render(item);
    socket.on("whiteboard:init", initial);
    socket.on("whiteboard:created", created);
    socket.on("whiteboard:stroke", stroke);
    socket.on("whiteboard:clear", clearCanvas);
    socket.emit("whiteboard:request-sync");
    return () => {
      socket.off("whiteboard:init", initial);
      socket.off("whiteboard:created", created);
      socket.off("whiteboard:stroke", stroke);
      socket.off("whiteboard:clear", clearCanvas);
    };
  }, [socket]);
  const levels = canManage
    ? ["VIEW", "DRAW", "EDIT", "CLEAR", "ADMIN"]
    : (permissions.whiteboard ?? ["VIEW"]);
  const canView =
    canManage || levels.includes("VIEW") || levels.includes("ADMIN");
  const canDraw =
    canManage || levels.includes("DRAW") || levels.includes("ADMIN");
  const canEdit =
    canManage || levels.includes("EDIT") || levels.includes("ADMIN");
  const canClear =
    canManage || levels.includes("CLEAR") || levels.includes("ADMIN");
  function begin(event) {
    if (!canvasRef.current || (tool === "pen" ? !canDraw : !canEdit)) return;
    drawingRef.current = true;
    lastPoint.current = pointFor(event, canvasRef.current);
    canvasRef.current.setPointerCapture?.(event.pointerId);
  }
  function move(event) {
    if (!drawingRef.current || !canvasRef.current || !lastPoint.current) return;
    const to = pointFor(event, canvasRef.current);
    const stroke = { from: lastPoint.current, to, color, size, tool };
    render(stroke);
    socket?.emit("whiteboard:stroke", stroke, (response) => {
      if (!response?.ok)
        setNotice(response?.message ?? "Whiteboard unavailable.");
    });
    lastPoint.current = to;
  }
  function end() {
    drawingRef.current = false;
    lastPoint.current = null;
  }
  function clear() {
    socket?.emit("whiteboard:clear", (response) => {
      if (!response?.ok)
        setNotice(response?.message ?? "Only the host can clear the board.");
    });
  }
  function create() {
    socket?.emit("whiteboard:create", (response) => {
      if (!response?.ok)
        setNotice(response?.message ?? "Whiteboard could not be created.");
    });
  }
  if (!canView)
    return (
      <section className="whiteboard">
        <header>
          <div>
            <p className="eyebrow">COLLABORATE</p>
            <h2>Shared whiteboard</h2>
          </div>
        </header>
        <p className="whiteboard-note">
          Whiteboard access is disabled by the host.
        </p>
      </section>
    );
  if (!active)
    return (
      <section className="whiteboard">
        <header>
          <div>
            <p className="eyebrow">COLLABORATE</p>
            <h2>Shared whiteboard</h2>
          </div>
          {canManage && <button onClick={create}>Create whiteboard</button>}
        </header>
        <p className="whiteboard-note">
          {canManage
            ? "Create the board, then decide which participants may draw."
            : "The host has not created a whiteboard yet."}
        </p>
        {notice && <p className="notice">{notice}</p>}
      </section>
    );
  return (
    <section className="whiteboard open">
      <header>
        <div>
          <p className="eyebrow">COLLABORATE</p>
          <h2>Shared whiteboard</h2>
        </div>
      </header>
      <div className="whiteboard-tools">
        <div>
          {canDraw && (
            <button
              className={tool === "pen" ? "active" : ""}
              onClick={() => setTool("pen")}
            >
              Pen
            </button>
          )}
          {canEdit && (
            <button
              className={tool === "eraser" ? "active" : ""}
              onClick={() => setTool("eraser")}
            >
              Eraser
            </button>
          )}
          {canDraw &&
            palette.map((item) => (
              <button
                aria-label={`Use ${item}`}
                className={`color-dot ${color === item ? "selected" : ""}`}
                key={item}
                style={{ background: item }}
                onClick={() => {
                  setColor(item);
                  setTool("pen");
                }}
              />
            ))}
        </div>
        {(canDraw || canEdit) && (
          <label>
            Size{" "}
            <input
              type="range"
              min="1"
              max="16"
              value={size}
              onChange={(event) => setSize(Number(event.target.value))}
            />
          </label>
        )}
        {canClear && (
          <button className="danger-outline" onClick={clear}>
            Clear board
          </button>
        )}
      </div>
      <canvas
        ref={canvasRef}
        className={`whiteboard-canvas ${canDraw || canEdit ? "" : "view-only"}`}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
      />
      {notice && <p className="notice">{notice}</p>}
      <p className="whiteboard-note">
        {canDraw || canEdit
          ? "Draw diagrams, algorithms, and system designs together."
          : "View only — the host has not enabled drawing."}{" "}
        The board remains available while this meeting is open.
      </p>
    </section>
  );
}
