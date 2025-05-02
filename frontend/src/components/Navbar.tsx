import { RxHamburgerMenu } from "react-icons/rx";
import { IoClose } from "react-icons/io5";
import { Button } from "./ui";
import { Link, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";

export const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <motion.nav 
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className={`fixed w-full z-50 transition-all duration-300 ${
        scrolled 
          ? "bg-opacity-90 backdrop-blur-md bg-[#1e1d1a] shadow-lg" 
          : "bg-transparent"
      }`}
    >
      <div className="max-w-screen-xl flex flex-wrap items-center justify-between mx-auto p-4">
        <Link
          to="/"
          className="flex items-center space-x-3 rtl:space-x-reverse"
        >
          <motion.span 
            className="self-center text-3xl font-bold whitespace-nowrap text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-green-500"
            whileHover={{ scale: 1.05 }}
            transition={{ type: "spring", stiffness: 400, damping: 10 }}
          >
            Drop&Win
          </motion.span>
        </Link>
        
        <button
          className="inline-flex items-center p-2 w-10 h-10 justify-center text-sm rounded-lg md:hidden focus:outline-none focus:ring-2 text-gray-300 hover:bg-gray-700 focus:ring-gray-600"
          onClick={() => {
            setIsMenuOpen(!isMenuOpen);
          }}
        >
          <span className="sr-only">Toggle menu</span>
          {isMenuOpen ? <IoClose size={24} /> : <RxHamburgerMenu size={24} />}
        </button>
        
        {/* Mobile menu */}
        {isMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="w-full md:hidden bg-[#262522] bg-opacity-95 backdrop-blur-md mt-4 p-4 rounded-lg"
          >
            <div className="flex flex-col space-y-3">
              <Button
                variant="outline"
                className="w-full text-center"
                onClick={() => {
                  navigate("/simulation");
                  setIsMenuOpen(false);
                }}
              >
                Simulation
              </Button>
              <Button
                variant="primary"
                className="w-full text-center"
                onClick={() => {
                  navigate("/game");
                  setIsMenuOpen(false);
                }}
              >
                Game
              </Button>
            </div>
          </motion.div>
        )}
        
        {/* Desktop menu */}
        <div className="hidden md:flex md:items-center md:space-x-4">
          <Button
            variant="outline"
            className="px-5"
            onClick={() => navigate("/simulation")}
          >
            Simulation
          </Button>
          <Button
            variant="primary"
            onClick={() => navigate("/game")}
          >
            Play Now
          </Button>
        </div>
      </div>
    </motion.nav>
  );
};

