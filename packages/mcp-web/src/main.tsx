import { createRoot } from "react-dom/client"
import "@xyflow/react/dist/style.css"
import "./app.css"
import { App } from "./app"
import { connectOg, loadSnapshot } from "./og"

createRoot(document.getElementById("root")!).render(<App />)

// Boot: snapshot primeiro (visitante anônimo já vê o grafo), depois a conexão
// SSE — connectOg() reusa nome/token cacheados se existirem (og.ts).
loadSnapshot()
connectOg()
