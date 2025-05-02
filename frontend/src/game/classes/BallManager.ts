import { HEIGHT, WIDTH, ballRadius, obstacleRadius, sinkWidth } from "../constants";
import { Obstacle, Sink, createObstacles, createSinks } from "../objects";
import { pad, unpad } from "../padding";
import { Ball } from "./Ball";

export class BallManager {
    private balls: Ball[];
    private canvasRef: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private obstacles: Obstacle[]
    private sinks: Sink[]
    private requestId?: number;
    private onFinish?: (index: number,startX?: number) => void;

    constructor(canvasRef: HTMLCanvasElement, onFinish?: (index: number,startX?: number) => void) {
        this.balls = [];
        this.canvasRef = canvasRef;
        this.ctx = this.canvasRef.getContext("2d")!;
        this.obstacles = createObstacles();
        this.sinks = createSinks();
        this.update();
        this.onFinish = onFinish;
    }

    addBall(startX?: number) {
        const gradientColors = ['#10b981', '#059669', '#047857'];
        const randomGradient = gradientColors[Math.floor(Math.random() * gradientColors.length)];
        const newBall = new Ball(startX || pad(WIDTH / 2 + 13), pad(50), ballRadius, randomGradient, this.ctx, this.obstacles, this.sinks, (index) => {
            this.balls = this.balls.filter(ball => ball !== newBall);
            this.onFinish?.(index, startX)
        });
        this.balls.push(newBall);
    }

    drawObstacles() {
        const gradient = this.ctx.createRadialGradient(
            WIDTH/2, HEIGHT/2, 10, 
            WIDTH/2, HEIGHT/2, WIDTH/2
        );
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
        gradient.addColorStop(1, 'rgba(220, 220, 255, 0.8)');
        
        this.ctx.fillStyle = gradient;
        this.ctx.shadowBlur = 5;
        this.obstacles.forEach((obstacle) => {
            this.ctx.beginPath();
            this.ctx.arc(unpad(obstacle.x), unpad(obstacle.y), obstacle.radius, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.closePath();
        });
        this.ctx.shadowBlur = 0;
    }
  
    getColor(index: number) {
        if (index <3 || index > this.sinks.length - 3) {
            return {background: '#ef4444', color: 'white'};
        }
        if (index < 6 || index > this.sinks.length - 6) {
            return {background: '#f97316', color: 'white'};
        }
        if (index < 9 || index > this.sinks.length - 9) {
            return {background: '#f59e0b', color: 'white'};
        }
        if (index < 12 || index > this.sinks.length - 12) {
            return {background: '#84cc16', color: 'white'};
        }
        if (index < 15 || index > this.sinks.length - 15) {
            return {background: '#10b981', color: 'white'};
        }
        return {background: '#059669', color: 'white'};
    }
    drawSinks() {
        this.ctx.fillStyle = 'green';
        const SPACING = obstacleRadius * 2;
        for (let i = 0; i<this.sinks.length; i++)  {
            this.ctx.fillStyle = this.getColor(i).background;
            const sink = this.sinks[i];
            this.ctx.font='normal 13px Arial';
            this.ctx.fillRect(sink.x, sink.y - sink.height / 2, sink.width - SPACING, sink.height);
            this.ctx.fillStyle = this.getColor(i).color;
            this.ctx.fillText((sink?.multiplier)?.toString() + "x", sink.x - 15 + sinkWidth / 2, sink.y);
        };
    }

    draw() {
        const bgGradient = this.ctx.createLinearGradient(0, 0, 0, HEIGHT);
        bgGradient.addColorStop(0, '#1e1d1a');
        bgGradient.addColorStop(1, '#262522');
        
        this.ctx.fillStyle = bgGradient;
        this.ctx.fillRect(0, 0, WIDTH, HEIGHT);
        this.drawObstacles();
        this.drawSinks();
        this.balls.forEach(ball => {
            ball.draw();
            ball.update();
        });
    }
    
    update() {
        this.draw();
        this.requestId = requestAnimationFrame(this.update.bind(this));
    }

    stop() {
        if (this.requestId) {
            cancelAnimationFrame(this.requestId);
        }
    }
}