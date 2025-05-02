import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BallManager } from "../game/classes/BallManager";
import { pad } from "../game/padding";
import { WIDTH } from "../game/constants";
import { motion } from "framer-motion";

export const Simulate = () => {
  const navigate = useNavigate();
  const canvasRef = useRef<any>();
  let [outputs, setOutputs] = useState<{ [key: number]: number[] }>({
    0: [],
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
    7: [],
    8: [],
    9: [],
    10: [],
    11: [],
    12: [],
    13: [],
    14: [],
    15: [],
    16: [],
    17: [],
  });

  async function simulate(ballManager: BallManager) {
    let i = 0;
    while (1) {
      i++;
      ballManager.addBall(pad(WIDTH / 2 + 20 * (Math.random() - 0.5)));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  useEffect(() => {
    if (canvasRef.current) {
      const ballManager = new BallManager(
        canvasRef.current as unknown as HTMLCanvasElement,
        (index: number, startX?: number) => {
          setOutputs((outputs: any) => {
            return {
              ...outputs,
              [index]: [...(outputs[index] as number[]), startX],
            };
          });
        }
      );
      simulate(ballManager);

      return () => {
        ballManager.stop();
      };
    }
  }, [canvasRef]);

  return (
    <motion.div 
      className="flex flex-col items-center justify-center p-4"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, delay: 0.2 }}
    >
      <div className="relative">
        {/* Animated glow effect */}
        <motion.div 
          className="absolute -inset-2 bg-gradient-to-r from-green-500/20 to-emerald-500/30 rounded-xl blur-xl -z-10"
          animate={{ 
            scale: [1, 1.05, 1],
            opacity: [0.3, 0.5, 0.3]
          }}
          transition={{ 
            duration: 5, 
            repeat: Infinity,
            repeatType: "reverse" 
          }}
        />
        
        {/* Canvas container */}
        <div className="relative bg-background-darker rounded-xl p-2 backdrop-blur-sm shadow-lg border border-green-500/10 overflow-hidden">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <canvas 
              ref={canvasRef} 
              width="800" 
              height="700" 
              className="rounded-lg overflow-hidden max-w-full h-auto"
            ></canvas>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
};
