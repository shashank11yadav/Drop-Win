import { FaGithub, FaTwitter, FaYoutube } from "react-icons/fa";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";

export const Footer = () => {
  const socialIconVariants = {
    hover: {
      scale: 1.2,
      transition: {
        type: "spring",
        stiffness: 400,
        damping: 10
      }
    }
  };

  return (
    <footer className="mt-auto py-10 bg-gradient-to-b from-transparent to-[#1a1917]">
      <div className="w-[90%] max-w-screen-xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Brand Section */}
          <div className="flex flex-col items-center md:items-start">
            <Link to="/" className="flex items-center space-x-3">
              <span className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-green-500">
                Drop&Win
              </span>
            </Link>
            <p className="mt-4 text-gray-400 text-sm max-w-md">
              An exciting game where you drop a ball and win rewards based on where it lands. Test your luck and strategy!
            </p>
          </div>

          {/* Links Section */}
          <div className="flex flex-col items-center">
            <h3 className="text-lg font-semibold mb-4 text-white">Quick Links</h3>
            <ul className="space-y-2">
              <li>
                <Link to="/" className="text-gray-300 hover:text-green-400 transition-colors">
                  Home
                </Link>
              </li>
              <li>
                <Link to="/simulation" className="text-gray-300 hover:text-green-400 transition-colors">
                  Simulation
                </Link>
              </li>
              <li>
                <Link to="/game" className="text-gray-300 hover:text-green-400 transition-colors">
                  Play Game
                </Link>
              </li>
            </ul>
          </div>

          {/* Social Media Section */}
          <div className="flex flex-col items-center md:items-end">
            <h3 className="text-lg font-semibold mb-4 text-white">Connect With Me</h3>
            <div className="flex items-center gap-4">
              <motion.a 
                href="https://github.com/shashank11yadav" 
                target="_blank"
                variants={socialIconVariants}
                whileHover="hover"
                className="text-gray-300 hover:text-white"
              >
                <FaGithub size={28} />
              </motion.a>
              <motion.a 
                href="https://x.com/Shashankyadav30" 
                target="_blank"
                variants={socialIconVariants}
                whileHover="hover"
                className="text-gray-300 hover:text-white"
              >
                <FaTwitter size={28} />
              </motion.a>
            </div>
          </div>
        </div>
        
        <div className="mt-10 pt-6 border-t border-gray-700">
          <p className="text-center text-gray-400 text-sm">
            © {new Date().getFullYear()} Drop&Win. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};