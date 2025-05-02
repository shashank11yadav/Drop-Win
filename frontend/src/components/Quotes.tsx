import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FaGamepad, FaCoins } from "react-icons/fa";

export const Quotes = () => {
  const navigate = useNavigate();
  
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.3
      }
    }
  };
  
  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: { type: "spring", stiffness: 300, damping: 24 }
    }
  };

  return (
    <motion.div 
      className="flex flex-col justify-center items-center text-center p-8 md:p-16 bg-gradient-to-b from-[#2a2926] to-transparent rounded-xl backdrop-blur-sm shadow-xl max-w-4xl mx-auto"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div
        className="absolute -z-10 w-full h-full opacity-10 bg-gradient-to-r from-green-400 to-emerald-600 blur-3xl rounded-full"
        animate={{ 
          scale: [1, 1.05, 1], 
          rotate: [0, 1, 0],
          opacity: [0.05, 0.08, 0.05]
        }}
        transition={{ 
          duration: 8, 
          repeat: Infinity,
          repeatType: "reverse" 
        }}
      />
      
      <motion.div 
        className="flex items-center justify-center mb-4"
        variants={itemVariants}
      >
        <FaGamepad className="text-green-400 text-4xl mr-3" />
        <h1 className="text-5xl md:text-6xl font-extrabold">
          <span className="text-white">Play </span>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-green-500">
            Drop&Win
          </span>
        </h1>
      </motion.div>
      
      <motion.h2 
        className="text-2xl md:text-3xl font-bold text-green-400 mb-6"
        variants={itemVariants}
      >
        Play Smart, Earn More!
      </motion.h2>
      
      <motion.p
        className="text-lg md:text-xl text-gray-300 mb-8 max-w-2xl leading-relaxed"
        variants={itemVariants}
      >
        Drop your ball from the top of our triangular pin pyramid and watch it navigate its way down to your winning multiplier. Inspired by Pachinko, <span className="font-semibold text-green-300">Drop&Win</span> delivers an electrifying gaming experience!
      </motion.p>
      
      <motion.div
        className="flex flex-col sm:flex-row gap-4 w-full max-w-md"
        variants={itemVariants}
      >
        <motion.button
          className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-green-500 text-white px-6 py-4 rounded-lg text-lg font-medium shadow-lg hover:shadow-emerald-500/20 hover:from-emerald-600 hover:to-green-600 transition-all duration-300"
          onClick={() => navigate("/game")}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.98 }}
        >
          <FaCoins className="text-yellow-300" />
          Play Now
        </motion.button>
        
        <motion.button
          className="flex-1 border-2 border-green-500 text-green-400 px-6 py-4 rounded-lg text-lg font-medium hover:bg-green-500/10 transition-all duration-300"
          onClick={() => navigate("/simulation")}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.98 }}
        >
          Try Simulation
        </motion.button>
      </motion.div>
    </motion.div>
  );
};
