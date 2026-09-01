/**
 * API Service Layer for EFEM Semiconductor Simulator
 * Provides interfaces for backend communication, recipe management, and telemetry
 */

export interface RecipeStep {
  id: string;
  name: string;
  type: "hot" | "cold" | "scan" | "coat" | "wet" | "dry" | "iface" | "foup";
  time: number;
  temp?: number;
  x?: number;
  z?: number;
}

export interface WaferData {
  id: number;
  name: string;
  stepIdx: number;
  state: "idle" | "processing" | "moving" | "done";
  timer: number;
  progress: number;
  modName: string;
}

export interface SimulationState {
  wafers: WaferData[];
  simTime: number;
  fps: number;
  completed: number;
  active: number;
  paused: boolean;
  speed: number;
}

export interface ProcessTelemetry {
  timestamp: number;
  waferId: number;
  stepId: string;
  temperature: number;
  pressure?: number;
  humidity?: number;
  spinSpeed?: number;
  uvIntensity?: number;
}

export interface Recipe {
  id: string;
  name: string;
  steps: RecipeStep[];
  createdAt: string;
  updatedAt: string;
}

class ApiService {
  private baseUrl: string;
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<(data: unknown) => void>> = new Map();

  constructor(baseUrl: string = "/api") {
    this.baseUrl = baseUrl;
  }

  // Recipe Management
  async getRecipes(): Promise<Recipe[]> {
    try {
      const res = await fetch(`${this.baseUrl}/recipes`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (error) {
      console.warn("Recipe fetch failed, using offline mode:", error);
      return [];
    }
  }

  async getRecipe(id: string): Promise<Recipe | null> {
    try {
      const res = await fetch(`${this.baseUrl}/recipes/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (error) {
      console.warn("Recipe fetch failed:", error);
      return null;
    }
  }

  async saveRecipe(recipe: Omit<Recipe, "id" | "createdAt" | "updatedAt">): Promise<Recipe | null> {
    try {
      const res = await fetch(`${this.baseUrl}/recipes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recipe),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (error) {
      console.warn("Recipe save failed:", error);
      return null;
    }
  }

  // Telemetry
  async sendTelemetry(data: ProcessTelemetry): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/telemetry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getTelemetryHistory(waferId?: number, limit: number = 100): Promise<ProcessTelemetry[]> {
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (waferId !== undefined) params.set("waferId", String(waferId));
      const res = await fetch(`${this.baseUrl}/telemetry?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch {
      return [];
    }
  }

  // WebSocket for real-time updates
  connectWebSocket(onMessage: (data: unknown) => void): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return true;
    }

    try {
      const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/ws";
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("WebSocket connected");
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessage(data);
        } catch (e) {
          console.warn("Invalid WS message:", e);
        }
      };

      this.ws.onerror = (error) => {
        console.warn("WebSocket error:", error);
      };

      this.ws.onclose = () => {
        console.log("WebSocket disconnected");
        this.ws = null;
      };

      return true;
    } catch (error) {
      console.warn("WebSocket connection failed:", error);
      return false;
    }
  }

  disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  sendWsMessage(type: string, payload: unknown): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  }

  // Event emitter pattern for component communication
  subscribe(event: string, callback: (data: unknown) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  emit(event: string, data: unknown): void {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const apiService = new ApiService();
export default apiService;