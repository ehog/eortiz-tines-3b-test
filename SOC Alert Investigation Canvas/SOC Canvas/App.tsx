import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Canvas from "./Canvas";
import Launcher from "./Launcher";
import RunView from "./RunView";

export default function App() {
  const basename = (window.__ROUTE_PATH__ ?? "/").replace(/\/+$/, "") || "/";
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-teal-500/30">
      <BrowserRouter basename={basename}>
        <Routes>
          <Route path="/" element={<Launcher />} />
          <Route path="/run/:id" element={<RunView />} />
          <Route path="/investigation/:id" element={<Canvas />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}
