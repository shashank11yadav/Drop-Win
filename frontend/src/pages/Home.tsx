import { useEffect, useRef, useState } from "react";
import { BallManager } from "../game/classes/BallManager";
import { WIDTH } from "../game/constants";
import { pad } from "../game/padding";
import { Simulate } from "../components/Simulate";
import { Quotes } from "../components";
import { motion } from "framer-motion";

export function Home() {
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
    <div className="relative overflow-hidden">
      {/* Background animation elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-green-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -left-24 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-green-600/10 rounded-full blur-3xl" />
      </div>
      
      {/* Hero section */}
      <motion.section 
        className="pt-10 md:pt-20 pb-20"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
      >
        <div className="w-[90%] max-w-screen-xl mx-auto">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-10">
            <Quotes />
            <Simulate />
          </div>
        </div>
      </motion.section>
    </div>
  );
}
