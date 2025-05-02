import { useEffect, useRef, useState } from "react";
import { BallManager } from "../game/classes/BallManager";
import axios from "axios";
import { Button } from "../components/ui";
import { baseURL } from "../utils";
import { motion, AnimatePresence } from "framer-motion";

export function Game() {
  const [ballManager, setBallManager] = useState<BallManager>();
  const canvasRef = useRef<any>();
  const [userGuess, setUserGuess] = useState<string>("");
  const [lastResult, setLastResult] = useState<number | null>(null);
  const [showPopup, setShowPopup] = useState<boolean>(false);
  const [isCorrectGuess, setIsCorrectGuess] = useState<boolean>(false);
  const [isDropping, setIsDropping] = useState<boolean>(false);

  useEffect(() => {
    if (canvasRef.current) {
      const ballManager = new BallManager(
        canvasRef.current as unknown as HTMLCanvasElement,
        (index: number) => {
          // This callback runs when a ball finishes its path
          setLastResult(index);
          setIsDropping(false);

          // Check if the user's guess matches the result
          const guessNumber = parseInt(userGuess);
          if (!isNaN(guessNumber) && guessNumber === index) {
            setIsCorrectGuess(true);
            setShowPopup(true);
            // Hide popup after 3 seconds
            setTimeout(() => {
              setShowPopup(false);
            }, 3000);
          }
        }
      );
      setBallManager(ballManager);

      return () => {
        ballManager.stop();
      };
    }
  }, [canvasRef, userGuess]);

  const handleAddBall = async () => {
    // Only disable button if a ball is dropping AND user has entered a guess
    if (isDropping && userGuess !== "") return;

    // Always set dropping state regardless of whether there's a guess
    setIsDropping(true);
    
    try {
      const response = await axios.post(`${baseURL}/game`, {
        data: 1,
      });
      if (ballManager) {
        ballManager.addBall(response.data.point);
      }
    } catch (error) {
      console.error("Error adding ball:", error);
      setIsDropping(false);
    }
  };

  // Determine if button should be disabled based on state
  const isButtonDisabled = isDropping && userGuess !== "";

  return (
    <div className="relative w-full max-w-screen-xl mx-auto px-4 py-5 flex flex-col items-center justify-center">
      {/* Success Popup */}
      <AnimatePresence>
        {showPopup && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50"
          >
            <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-6 py-3 rounded-lg shadow-lg">
              <div className="flex items-center">
                <svg
                  className="w-6 h-6 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5 13l4 4L19 7"
                  ></path>
                </svg>
                <span className="font-medium">Voila! You got it right!</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main content - Responsive layout */}
      <div className="w-full flex flex-col lg:flex-row items-center justify-center gap-6">
        {/* Canvas container - Scales down on smaller screens */}
        <div className="relative bg-background-darker rounded-xl p-2 backdrop-blur-sm shadow-lg border border-green-500/10 overflow-hidden w-full lg:w-auto">
          <canvas
            ref={canvasRef}
            width="800"
            height="700"
            className="rounded-lg w-full max-w-full h-auto"
            style={{ aspectRatio: '8/7' }}
          ></canvas>
        </div>
        
        {/* Controls section - Side panel on desktop, bottom panel on mobile */}
        <div className="w-full lg:w-auto lg:max-w-xs flex flex-col items-center lg:items-start">
          <div className="text-center lg:text-left mb-4">
            <h2 className="text-2xl font-bold text-gradient mb-2">Drop & Win</h2>
            <p className="text-gray-300">
              Guess which sink the ball will fall into!
            </p>
          </div>

          <div className="flex flex-col items-center lg:items-stretch gap-4 mb-6 w-full">
            <div className="relative w-full">
              <input
                type="number"
                min="0"
                max="17"
                value={userGuess}
                onChange={(e) => setUserGuess(e.target.value)}
                placeholder="Enter sink # (0-17)"
                className="bg-background-darker text-white px-4 py-2 rounded-lg border border-green-500/30 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 w-full"
                disabled={isButtonDisabled}
              />
            </div>

            <Button
              onClick={handleAddBall}
              className={`w-full ${
                isButtonDisabled ? "opacity-70 cursor-not-allowed" : ""
              }`}
              variant="primary"
            >
              {isDropping ? "Dropping..." : "Drop Ball"}
            </Button>
          </div>

          {lastResult !== null && (
            <div className="text-lg mb-4 text-center lg:text-left w-full">
              <span className="text-gray-300">Last result: </span>
              <span className="font-semibold text-gradient">
                {lastResult}
              </span>
            </div>
          )}

          <div className="mt-2 text-center lg:text-left text-gray-400 text-sm">
            <p>
              Enter a number between 0-17 to guess which sink the ball will fall
              into. The outer sinks have higher multipliers but are harder to
              hit!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
