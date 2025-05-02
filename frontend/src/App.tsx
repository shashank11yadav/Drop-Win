import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Simulation } from "./pages/Simulation";
import { Game } from "./pages/Game";
import { Footer, Navbar } from "./components";
import { Home } from "./pages/Home";

function App() {
  return (
    <BrowserRouter>
      <div className="flex flex-col min-h-screen bg-[#302e2b]">
        <Navbar />
        <main className="flex-grow pt-20">
          {/* Routes */}
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/simulation" element={<Simulation />} />
            <Route path="/game" element={<Game />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}

export default App;
